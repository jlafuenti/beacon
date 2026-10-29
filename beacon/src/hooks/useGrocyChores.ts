import { useState, useEffect, useCallback, useMemo } from 'react';
import { haFetch, callHaService, fireHaEvent, hasToken } from '../api/ha-rest';
import { FamilyMember } from '../types/family';

/**
 * Grocy-backed chores for the adults (Lafuenti fork).
 *
 * Grocy owns the schedule; HA's Grocy integration exposes every active
 * chore on `sensor.grocy_chores` (attribute `chores`), and a pair of HA
 * automations mirror the ones that are due onto one local todo list per
 * adult (item description = `chore_id:<id>`, the only reliable key) and
 * nag the phones. Routing is the chore's `userfields.AssignedTo`: a name,
 * or blank, which means BOTH adults. Completion goes back through the same
 * event the phone buttons fire (`mobile_app_notification_action`, action
 * `CHORE_DONE__<id>__<person>`) so the phone loop stays the single owner
 * of "done" (it executes the chore in Grocy as that user and clears both
 * lists). See Atlas/Chore Notification Loop.md in Jesse's vault.
 */

export interface GrocyChore {
  id: number;
  name: string;
  description: string | null;
  /** Grocy's next due time (ISO) or null for manual/sensor-driven chores. */
  nextDue: string | null;
  assignedTo: string | null;
}

export interface GrocyChoreRow extends GrocyChore {
  /** Open todo item on this person's list, when the chore is due for them. */
  dueItem?: { uid: string; due?: string };
  /** Grocy's next due time is before today. */
  overdue: boolean;
}

export interface GrocyMemberChores {
  member: FamilyMember;
  /** Chores with an open item on this person's list (overdue ones flagged). */
  due: GrocyChoreRow[];
  /** The rest of this person's chores due within the next week, soonest first. */
  comingUp: GrocyChoreRow[];
}

export interface UseGrocyChoresOptions {
  enabled: boolean;
  sensorEntity: string;
  /** Member name → todo entity holding that person's due chores. */
  listsByMember: Record<string, string>;
}

interface TodoItem {
  uid: string;
  summary: string;
  status: 'needs_action' | 'completed';
  description?: string;
  due?: string;
}

const REFRESH_MS = 60_000;
const CHORE_ID_RE = /chore_id:(\d+)/;
/** "Coming up" only looks this far ahead. */
const COMING_UP_DAYS = 7;

/** Convention when no explicit list is configured: todo.<first name>_s_chores. */
export function defaultChoreList(member: FamilyMember): string {
  const slug = member.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  return slug ? `todo.${slug}_s_chores` : '';
}

export function resolveChoreList(member: FamilyMember, listsByMember: Record<string, string>): string {
  return listsByMember[member.name] || listsByMember[member.name.toLowerCase()] || defaultChoreList(member);
}

/** The `<person>` token of the notification action: the member's first name, lowercased. */
export function personKey(member: FamilyMember): string {
  return member.name.trim().split(/\s+/)[0].toLowerCase();
}

function parseChores(attrs: Record<string, unknown>): GrocyChore[] {
  const raw = Array.isArray(attrs.chores) ? (attrs.chores as Array<Record<string, unknown>>) : [];
  return raw
    .filter((c) => typeof c.id === 'number' && typeof c.name === 'string')
    .map((c) => {
      const userfields = (c.userfields ?? {}) as Record<string, unknown>;
      const assigned = typeof userfields.AssignedTo === 'string' ? userfields.AssignedTo.trim() : '';
      return {
        id: c.id as number,
        name: c.name as string,
        description: typeof c.description === 'string' ? c.description : null,
        nextDue: typeof c.next_estimated_execution_time === 'string' ? c.next_estimated_execution_time : null,
        assignedTo: assigned || null,
      };
    });
}

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function useGrocyChores(members: FamilyMember[], options: UseGrocyChoresOptions) {
  const { enabled, sensorEntity } = options;
  const adults = useMemo(() => members.filter((m) => m.role === 'parent'), [members]);
  const listKey = adults.map((m) => `${m.id}=${resolveChoreList(m, options.listsByMember)}`).join('|');

  const [chores, setChores] = useState<GrocyChore[]>([]);
  const [openItems, setOpenItems] = useState<Record<string, TodoItem[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled || !hasToken() || !sensorEntity) return;
    setLoading(true);
    try {
      const sensor = await haFetch(`/api/states/${sensorEntity}`) as { attributes: Record<string, unknown> } | null;
      setChores(sensor ? parseChores(sensor.attributes) : []);

      const lists = listKey ? listKey.split('|').map((pair) => pair.split('=')[1]).filter(Boolean) : [];
      const unique = Array.from(new Set(lists));
      const next: Record<string, TodoItem[]> = {};
      await Promise.all(unique.map(async (entityId) => {
        try {
          const result = await callHaService('todo', 'get_items', { entity_id: entityId }, true) as {
            service_response?: Record<string, { items?: TodoItem[] }>;
          };
          next[entityId] = (result?.service_response?.[entityId]?.items ?? []).filter((i) => i.status === 'needs_action');
        } catch {
          next[entityId] = [];
        }
      }));
      setOpenItems(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
    } finally {
      setLoading(false);
    }
  }, [enabled, sensorEntity, listKey]);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const interval = setInterval(() => {
      if (!document.hidden) refresh();
    }, REFRESH_MS);
    const onVisible = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, refresh]);

  const byMember: GrocyMemberChores[] = useMemo(() => {
    const today = startOfToday();
    // Calendar days, not 7×24h: a DST change inside the window would
    // otherwise shift the cut-off by an hour and drop the last day.
    const horizonDate = new Date(today);
    horizonDate.setDate(horizonDate.getDate() + COMING_UP_DAYS);
    const horizon = horizonDate.getTime();
    return adults.map((member) => {
      const listId = resolveChoreList(member, options.listsByMember);
      const items = openItems[listId] ?? [];
      const dueByChore = new Map<number, TodoItem>();
      for (const item of items) {
        const m = CHORE_ID_RE.exec(item.description ?? '');
        if (m) dueByChore.set(Number(m[1]), item);
      }
      const mine = chores.filter((c) =>
        !c.assignedTo || c.assignedTo.toLowerCase() === member.name.trim().toLowerCase(),
      );
      const due: GrocyChoreRow[] = [];
      const comingUp: GrocyChoreRow[] = [];
      for (const chore of mine) {
        const overdue = !!chore.nextDue && new Date(chore.nextDue).getTime() < today;
        const item = dueByChore.get(chore.id);
        if (item) {
          due.push({ ...chore, overdue, dueItem: { uid: item.uid, due: item.due } });
        } else if (chore.nextDue && new Date(chore.nextDue).getTime() < horizon) {
          comingUp.push({ ...chore, overdue });
        }
        // null next date and no list item: sensor-driven, not due → hidden
        // next date beyond the week: not shown yet
      }
      const byDate = (a: GrocyChoreRow, b: GrocyChoreRow) => (a.nextDue ?? '').localeCompare(b.nextDue ?? '');
      due.sort(byDate);
      comingUp.sort(byDate);
      return { member, due, comingUp };
    });
  }, [adults, chores, openItems, options.listsByMember]);

  /** Mark a chore done as this member: fires the phone-button event and drops it from the UI. */
  const completeChore = useCallback(async (choreId: number, member: FamilyMember) => {
    const listId = resolveChoreList(member, options.listsByMember);
    const action = `CHORE_DONE__${choreId}__${personKey(member)}`;
    // Optimistic: remove the item from every list (the automation clears both)
    setOpenItems((prev) => {
      const next: Record<string, TodoItem[]> = {};
      for (const [id, items] of Object.entries(prev)) {
        next[id] = items.filter((i) => !(CHORE_ID_RE.exec(i.description ?? '')?.[1] === String(choreId)));
      }
      if (!next[listId]) next[listId] = [];
      return next;
    });
    try {
      await fireHaEvent('mobile_app_notification_action', { action });
    } catch (err) {
      console.warn('useGrocyChores: failed to fire done event', err);
    }
    // The HA automation takes a few seconds (Grocy execute + list cleanup);
    // refresh once it has had time to finish, then once more to be sure.
    setTimeout(refresh, 6_000);
    setTimeout(refresh, 15_000);
  }, [options.listsByMember, refresh]);

  return { byMember, loading, error, refresh, completeChore };
}

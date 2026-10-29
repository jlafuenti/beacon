import { useState, useEffect, useCallback, useMemo } from 'react';
import { hasToken, haFetch, callHaService } from '../api/ha-rest';
import { useLocalTasks } from './useLocalTasks';
import { useTaskmate } from './useTaskmate';

export interface DashboardTodoItem {
  uid: string;
  summary: string;
  status: 'needs_action' | 'completed';
  listId: string;
  userId?: string;
}

export function useDashboardTasks(
  connected: boolean,
  groceryListIds: string[] = [],
  taskListIds: string[] = [],
  includeLocal = true,
) {
  const localTasks = useLocalTasks();
  const { users, listByUser, completions } = useTaskmate(connected);
  const [haItems, setHaItems] = useState<Omit<DashboardTodoItem, 'userId'>[]>([]);

  // Stable keys so a fresh array with the same ids does not restart the poll
  const groceryKey = groceryListIds.join(',');
  const taskKey = taskListIds.join(',');

  // Fetch HA todo items for task-type lists
  useEffect(() => {
    if (!connected && !hasToken()) return;
    const groceryIds = groceryKey ? groceryKey.split(',') : [];
    const taskIds = taskKey ? taskKey.split(',') : [];

    async function fetchTasks() {
      try {
        // Get the non-grocery HA todo entities
        const states = await haFetch('/api/states') as Array<{ entity_id: string; state: string; attributes: Record<string, unknown> }>;

        const available = states.filter(s => s.entity_id.startsWith('todo.') && s.state !== 'unavailable');

        // Allowlist wins when configured (same lists as the Tasks tab, same order)
        const todoEntities = taskIds.length > 0
          ? taskIds
              .map(id => available.find(s => s.entity_id === id))
              .filter((s): s is typeof available[number] => !!s)
          : available.filter(s => {
              const name = s.attributes.friendly_name as string || s.entity_id;
              // Use groceryListIds if configured, otherwise fall back to keyword classification
              if (groceryIds.length > 0) {
                return !groceryIds.includes(s.entity_id);
              }
              return !isGroceryEntity(name);
            }).slice(0, 3);

        // Fetch items from the chosen task lists
        const items: Omit<DashboardTodoItem, 'userId'>[] = [];
        for (const entity of todoEntities) {
          try {
            const result = await callHaService('todo', 'get_items', {
              entity_id: entity.entity_id,
            }, true) as {
              service_response?: Record<string, { items?: Array<{ uid: string; summary: string; status: string }> }>;
            };
            const entityItems = result?.service_response?.[entity.entity_id]?.items ?? [];
            for (const item of entityItems) {
              items.push({
                uid: item.uid,
                summary: item.summary,
                status: item.status as 'needs_action' | 'completed',
                listId: entity.entity_id,
              });
            }
          } catch { /* skip failed lists */ }
        }
        setHaItems(items);
      } catch (err) {
        console.warn('Failed to fetch dashboard tasks:', err);
      }
    }

    fetchTasks();
    const interval = setInterval(fetchTasks, 60_000);
    return () => clearInterval(interval);
  }, [connected, groceryKey, taskKey]);

  const items: DashboardTodoItem[] = useMemo(() => {
    const local: DashboardTodoItem[] = !includeLocal ? [] : localTasks
      .getTasksForList('beacon-todo')
      .filter(t => t.status === 'needs_action' || (t.completedAt ? isToday(t.completedAt) : false))
      .map(t => ({
        uid: t.id,
        summary: t.summary,
        status: t.status,
        listId: 'beacon-todo',
      }));

    const fromHa: DashboardTodoItem[] = [];
    for (const i of haItems) {
      const userId = listByUser[i.listId]?.childId;
      if (i.status === 'needs_action' || userId != null) {
        fromHa.push({ ...i, userId });
      }
    }

    const done: DashboardTodoItem[] = completions.map(c => ({
      uid: c.uid,
      summary: c.summary,
      status: 'completed' as const,
      listId: '',
      userId: c.userId,
    }));

    const seen = new Set<string>();
    return [...local, ...fromHa, ...done].filter(it => {
      const key = `${it.userId ?? ''}:${it.uid}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [localTasks, haItems, listByUser, completions, includeLocal]);

  const toggleItem = useCallback(async (uid: string, currentStatus: string, listId?: string) => {
    // Check if it's a local item
    const localItem = localTasks.getTasksForList('beacon-todo').find(t => t.id === uid);
    if (localItem) {
      localTasks.toggleTask(uid);
      return;
    }

    const haItem = haItems.find(i => i.uid === uid && (listId == null || i.listId === listId))
      ?? haItems.find(i => i.uid === uid);
    if (!haItem) return;
    const newStatus = currentStatus === 'needs_action' ? 'completed' : 'needs_action';
    try {
      await callHaService('todo', 'update_item', {
        entity_id: haItem.listId,
        item: haItem.summary,
        status: newStatus,
      });
      setHaItems(prev => prev.map(i =>
        i.uid === uid && i.listId === haItem.listId
          ? { ...i, status: newStatus as 'needs_action' | 'completed' }
          : i
      ));
    } catch (err) {
      console.warn('Failed to toggle todo item:', err);
    }
  }, [localTasks, haItems]);

  return { items, toggleItem, users };
}

const GROCERY_KEYWORDS = [
  'grocer', 'shopping', 'costco', 'walmart', 'target', 'store',
  'pantry', 'fridge', 'freezer', 'inventory', 'meal',
];

function isGroceryEntity(name: string): boolean {
  const lower = name.toLowerCase();
  return GROCERY_KEYWORDS.some(kw => lower.includes(kw));
}

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

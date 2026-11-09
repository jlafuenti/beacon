import { useMemo } from 'react';
import { parseISO, isSameDay, startOfDay } from 'date-fns';
import { CalendarEvent } from '../types';
import { FamilyMember } from '../types/family';

export interface FamilyEventsMap {
  /** Events keyed by member ID */
  byMember: Map<string, CalendarEvent[]>;
  /** Events with no matching family member */
  other: CalendarEvent[];
}

/** Shared HA calendars attached by role (Settings > Family > Shared calendars, Lafuenti fork). */
export interface SharedCalendars {
  /** Shown under every parent-role member. */
  adults?: string;
  /** Shown under every child-role member. */
  children?: string;
}

/**
 * The HA calendars a member's column shows: their own primary and additional
 * calendars plus the shared calendar for their role.
 */
export function memberCalendarIds(member: FamilyMember, shared?: SharedCalendars): string[] {
  const ids = new Set<string>();
  if (member.calendar_entity) ids.add(member.calendar_entity);
  for (const entity of member.additional_calendar_entities || []) ids.add(entity);
  const roleShared = member.role === 'child' ? shared?.children : shared?.adults;
  if (roleShared) ids.add(roleShared);
  return Array.from(ids);
}

/**
 * Groups a given day's calendar events by family member. A calendar linked to
 * several members (two adults sharing one, or a shared role calendar) puts the
 * event under each of them. Events nobody claims go into `other`.
 */
export function useFamilyEvents(
  events: CalendarEvent[],
  members: FamilyMember[],
  referenceDate: Date = new Date(),
  shared?: SharedCalendars,
): FamilyEventsMap {
  const sharedAdults = shared?.adults ?? '';
  const sharedChildren = shared?.children ?? '';
  return useMemo(() => {
    const day = startOfDay(referenceDate);
    const todayEvents = events.filter((e) =>
      isSameDay(startOfDay(parseISO(e.start)), day),
    );

    // calendarId → every member it belongs to
    const calToMembers = new Map<string, string[]>();
    for (const m of members) {
      for (const id of memberCalendarIds(m, { adults: sharedAdults, children: sharedChildren })) {
        const list = calToMembers.get(id) ?? [];
        list.push(m.id);
        calToMembers.set(id, list);
      }
    }

    const byMember = new Map<string, CalendarEvent[]>();
    for (const m of members) {
      byMember.set(m.id, []);
    }

    const other: CalendarEvent[] = [];

    for (const event of todayEvents) {
      const owners = calToMembers.get(event.calendarId);
      if (owners && owners.length > 0) {
        for (const memberId of owners) byMember.get(memberId)?.push(event);
      } else {
        other.push(event);
      }
    }

    // Sort each member's events by start time
    for (const evts of byMember.values()) {
      evts.sort((a, b) => a.start.localeCompare(b.start));
    }
    other.sort((a, b) => a.start.localeCompare(b.start));

    return { byMember, other };
  }, [events, members, referenceDate, sharedAdults, sharedChildren]);
}

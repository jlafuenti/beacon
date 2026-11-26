/**
 * Pure helpers for the Timers tab (Lafuenti fork).
 *
 * The tab merges four sources: Assist voice timers (from the add-on bridge),
 * HA timer helpers that a script owns (tummy time), Kiosk Satellite alarm
 * entities, and satellite firmware alarms. Everything here is side-effect
 * free so it can be tested without Home Assistant.
 */

export interface VoiceTimer {
  id: string;
  name: string;
  device_id: string;
  is_active: boolean;
  start_hours: number;
  start_minutes: number;
  start_seconds: number;
  /** Seconds left when the bridge last asked HA. */
  total_seconds_left: number;
}

export interface EntityState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
}

export type TimerAction = 'pause' | 'resume' | 'cancel';

/** Seconds left now, counting down locally from the bridge's last answer. */
export function voiceTimerRemaining(timer: VoiceTimer, fetchedAt: number, now: number): number {
  if (!timer.is_active) return Math.max(0, Math.round(timer.total_seconds_left));
  const elapsed = Math.max(0, (now - fetchedAt) / 1000);
  return Math.max(0, Math.round(timer.total_seconds_left - elapsed));
}

export function timerTotalSeconds(timer: Pick<VoiceTimer, 'start_hours' | 'start_minutes' | 'start_seconds'>): number {
  return timer.start_hours * 3600 + timer.start_minutes * 60 + timer.start_seconds;
}

/** 1:05:09, 4:07, 0:09 */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** "45 minute", "1 hour 30 minute", "90 second" — how the built-in timer sentences name an unnamed timer. */
export function spokenDuration(timer: Pick<VoiceTimer, 'start_hours' | 'start_minutes' | 'start_seconds'>): string {
  const parts: string[] = [];
  if (timer.start_hours) parts.push(`${timer.start_hours} hour`);
  if (timer.start_minutes) parts.push(`${timer.start_minutes} minute`);
  if (timer.start_seconds) parts.push(`${timer.start_seconds} second`);
  return parts.join(' ') || '0 second';
}

/** A timer name is only safe to speak back if it is plain words. */
function speakableName(name: string): string | null {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (!trimmed || trimmed.length > 60) return null;
  if (!/^[\p{L}\p{N} '’-]+$/u.test(trimmed)) return null;
  return trimmed;
}

/**
 * The built-in sentence that targets this timer: "pause the potatoes timer",
 * or by its starting length when it has no usable name ("cancel the 45 minute timer").
 */
export function timerSentence(action: TimerAction, timer: VoiceTimer): string {
  const name = speakableName(timer.name);
  return `${action} the ${name ?? spokenDuration(timer)} timer`;
}

/** Display title for a voice timer. */
export function voiceTimerTitle(timer: VoiceTimer): string {
  const name = timer.name.trim();
  if (name) return name.charAt(0).toUpperCase() + name.slice(1);
  return `${spokenDuration(timer).replace(/(\d+) (hour|minute|second)/g, (_m, n: string, u: string) => `${n} ${u}${n === '1' ? '' : 's'}`)} timer`;
}

/** Voice timers sorted: running first, soonest to finish first. */
export function sortVoiceTimers(timers: VoiceTimer[]): VoiceTimer[] {
  return [...timers].sort((a, b) => {
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
    return a.total_seconds_left - b.total_seconds_left;
  });
}

// ---------------------------------------------------------------------------
// Tummy-time style timer helpers
// ---------------------------------------------------------------------------

export interface HelperTimerRow {
  entityId: string;
  child: string;
  state: 'active' | 'paused';
  /** Seconds the session has run (it counts up: what gets logged is the elapsed time). */
  elapsedSeconds: number;
}

function parseHms(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = value.match(/^(?:(\d+) days?, )?(\d+):(\d{2}):(\d{2})$/);
  if (!m) return null;
  return (Number(m[1] ?? 0) * 86400) + Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]);
}

/** Running or paused HA timer helpers mapped to a child; idle ones are left out. */
export function helperTimerRows(
  map: Record<string, string>,
  entities: Record<string, EntityState>,
  now: number,
): HelperTimerRow[] {
  const rows: HelperTimerRow[] = [];
  for (const [entityId, child] of Object.entries(map)) {
    const e = entities[entityId];
    if (!e || (e.state !== 'active' && e.state !== 'paused')) continue;
    const duration = parseHms(e.attributes.duration) ?? 0;
    let remaining: number | null = null;
    if (e.state === 'active' && typeof e.attributes.finishes_at === 'string') {
      const end = Date.parse(e.attributes.finishes_at);
      if (!Number.isNaN(end)) remaining = Math.max(0, (end - now) / 1000);
    } else {
      remaining = parseHms(e.attributes.remaining);
    }
    rows.push({
      entityId,
      child,
      state: e.state,
      elapsedSeconds: Math.max(0, Math.round(duration - (remaining ?? duration))),
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Alarms
// ---------------------------------------------------------------------------

export interface KioskAlarmDevice {
  /** Entity id stem: sensor.<prefix>_next_alarm, button.<prefix>_stop_alarm, ... */
  prefix: string;
  name: string;
}

export function kioskAlarmEntityIds(device: KioskAlarmDevice) {
  const p = device.prefix;
  return {
    next: `sensor.${p}_next_alarm`,
    snoozedUntil: `sensor.${p}_alarm_snoozed_until`,
    ringing: `binary_sensor.${p}_alarm_ringing`,
    stop: `button.${p}_stop_alarm`,
    snooze: `button.${p}_snooze_alarm`,
    skip: `button.${p}_skip_next_alarm`,
  };
}

export interface KioskAlarmRow {
  device: KioskAlarmDevice;
  ringing: boolean;
  /** ms epoch, or null */
  next: number | null;
  snoozedUntil: number | null;
  ids: ReturnType<typeof kioskAlarmEntityIds>;
}

function parseTimestamp(state: string | undefined): number | null {
  if (!state || state === 'unknown' || state === 'unavailable') return null;
  const t = Date.parse(state);
  return Number.isNaN(t) ? null : t;
}

/** Only devices with something to show: ringing, snoozed or a next alarm set. */
export function kioskAlarmRows(devices: KioskAlarmDevice[], entities: Record<string, EntityState>): KioskAlarmRow[] {
  const rows: KioskAlarmRow[] = [];
  for (const device of devices) {
    const ids = kioskAlarmEntityIds(device);
    const ringing = entities[ids.ringing]?.state === 'on';
    const next = parseTimestamp(entities[ids.next]?.state);
    const snoozedUntil = parseTimestamp(entities[ids.snoozedUntil]?.state);
    if (!ringing && next === null && snoozedUntil === null) continue;
    rows.push({ device, ringing, next, snoozedUntil, ids });
  }
  return rows;
}

export interface SatelliteAlarm {
  name: string;
  /** switch that arms the firmware alarm */
  switchEntity: string;
  /** time entity holding HH:MM:SS */
  timeEntity: string;
}

export interface SatelliteAlarmRow {
  alarm: SatelliteAlarm;
  time: string;
}

/** Armed satellite firmware alarms only. "07:30:00" → "7:30 AM" is left to the view. */
export function satelliteAlarmRows(alarms: SatelliteAlarm[], entities: Record<string, EntityState>): SatelliteAlarmRow[] {
  return alarms
    .filter((a) => entities[a.switchEntity]?.state === 'on')
    .map((a) => ({ alarm: a, time: entities[a.timeEntity]?.state ?? '' }));
}

export interface VoiceAlarm {
  id: string;
  /** ms epoch */
  at: number;
  label: string;
  satellite: string;
}

/** Pending voice alarms from the store sensor's `alarms` attribute, soonest first. */
export function voiceAlarmRows(entity: EntityState | undefined): VoiceAlarm[] {
  const raw = entity?.attributes.alarms;
  if (!Array.isArray(raw)) return [];
  const rows: VoiceAlarm[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const at = typeof r.at === 'string' ? Date.parse(r.at) : NaN;
    if (typeof r.id !== 'string' || !r.id || Number.isNaN(at)) continue;
    rows.push({
      id: r.id,
      at,
      label: typeof r.label === 'string' ? r.label : '',
      satellite: typeof r.satellite_name === 'string' && r.satellite_name
        ? r.satellite_name
        : typeof r.satellite === 'string' ? r.satellite : '',
    });
  }
  return rows.sort((a, b) => a.at - b.at);
}

/** "07:30:00" → minutes since midnight, for display formatting. */
export function hmsToDate(hms: string, base: Date): Date | null {
  const m = hms.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const d = new Date(base);
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return d;
}

/** Every entity the tab needs polled, deduplicated. */
export function timersTabEntityIds(opts: {
  tummyTimers: Record<string, string>;
  kioskAlarmDevices: KioskAlarmDevice[];
  satelliteAlarms: SatelliteAlarm[];
  voiceAlarmsEntity: string;
}): string[] {
  const ids = new Set<string>(Object.keys(opts.tummyTimers));
  for (const d of opts.kioskAlarmDevices) {
    const e = kioskAlarmEntityIds(d);
    ids.add(e.next);
    ids.add(e.snoozedUntil);
    ids.add(e.ringing);
  }
  for (const a of opts.satelliteAlarms) {
    ids.add(a.switchEntity);
    ids.add(a.timeEntity);
  }
  if (opts.voiceAlarmsEntity) ids.add(opts.voiceAlarmsEntity);
  return [...ids].filter(Boolean).sort();
}

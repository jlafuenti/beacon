/**
 * Timers tab bridge calls (Lafuenti fork). Both go through the add-on's
 * /beacon-action/timers endpoint: HA core only lists Assist voice timers
 * through the HassTimerStatus intent over its WebSocket.
 */
import { callBeaconAction, callHaService } from './ha-rest';
import type { EntityState, TimerAction, VoiceTimer } from '../utils/houseTimers';
import { timerSentence } from '../utils/houseTimers';

export interface TimersSnapshot {
  voice_timers: VoiceTimer[];
  /** Server clock ms when HA was last asked; null when voice timers are off. */
  voice_fetched_at: number | null;
  voice_error: string | null;
  devices: Record<string, { name: string; area: string }>;
  entities: Record<string, EntityState>;
  /** Server clock ms when this answer was sent. */
  now: number;
}

export async function fetchTimersSnapshot(opts: {
  voice: boolean;
  voiceMaxAgeMs: number;
  entityIds: string[];
}): Promise<TimersSnapshot> {
  const res = await callBeaconAction('/beacon-action/timers', {
    op: 'list',
    voice: opts.voice,
    voice_max_age_ms: opts.voiceMaxAgeMs,
    entity_ids: opts.entityIds,
  }) as TimersSnapshot;
  return res;
}

/**
 * Pause, resume or cancel one voice timer. A Kiosk Satellite owner gets its
 * ESPHome action by timer id; any other satellite gets the built-in timer
 * sentence, sent as if spoken to it.
 */
export async function controlVoiceTimer(
  action: TimerAction,
  timer: VoiceTimer,
  kioskNodes: Record<string, string>,
): Promise<{ ok: boolean; via: string; speech: string | null }> {
  const node = kioskNodes[timer.device_id];
  const body = node
    ? { op: 'control', action, timer_id: timer.id, kiosk_node: node }
    : { op: 'control', action, text: timerSentence(action, timer), device_id: timer.device_id };
  return await callBeaconAction('/beacon-action/timers', body) as { ok: boolean; via: string; speech: string | null };
}

/** Tummy time and other script-owned helpers: never a raw timer.cancel, which would skip the log. */
export async function stopHelperTimer(script: string, child: string, action: 'stop' | 'cancel'): Promise<unknown> {
  const [domain, service] = script.split('.');
  return callHaService(domain, service, { child, activity: 'tummy_time', activity_action: action });
}

export async function pressButton(entityId: string): Promise<unknown> {
  return callHaService('button', 'press', { entity_id: entityId });
}

export async function turnOff(entityId: string): Promise<unknown> {
  const domain = entityId.split('.')[0];
  return callHaService(domain, 'turn_off', { entity_id: entityId });
}

export async function cancelVoiceAlarm(script: string, alarmId: string): Promise<unknown> {
  const [domain, service] = script.split('.');
  return callHaService(domain, service, { alarm_id: alarmId });
}

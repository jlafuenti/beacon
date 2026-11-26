import { describe, it, expect } from 'vitest';
import {
  formatClock,
  helperTimerRows,
  kioskAlarmRows,
  satelliteAlarmRows,
  sortVoiceTimers,
  spokenDuration,
  timerSentence,
  timersTabEntityIds,
  voiceAlarmRows,
  voiceTimerRemaining,
  voiceTimerTitle,
  type VoiceTimer,
} from './houseTimers';

const timer = (over: Partial<VoiceTimer> = {}): VoiceTimer => ({
  id: 't1',
  name: 'potatoes',
  device_id: 'dev1',
  is_active: true,
  start_hours: 0,
  start_minutes: 45,
  start_seconds: 0,
  total_seconds_left: 600,
  ...over,
});

describe('voice timers', () => {
  it('counts down locally from the last bridge answer', () => {
    expect(voiceTimerRemaining(timer(), 1_000, 11_000)).toBe(590);
    expect(voiceTimerRemaining(timer({ total_seconds_left: 5 }), 0, 60_000)).toBe(0);
  });

  it('does not count down a paused timer', () => {
    expect(voiceTimerRemaining(timer({ is_active: false }), 0, 60_000)).toBe(600);
  });

  it('formats clocks', () => {
    expect(formatClock(9)).toBe('0:09');
    expect(formatClock(247)).toBe('4:07');
    expect(formatClock(3909)).toBe('1:05:09');
  });

  it('builds the built-in timer sentence by name', () => {
    expect(timerSentence('pause', timer())).toBe('pause the potatoes timer');
    expect(timerSentence('cancel', timer({ name: 'Add green bean casserole topping' })))
      .toBe('cancel the Add green bean casserole topping timer');
  });

  it('falls back to the starting length for unnamed or unsafe names', () => {
    expect(timerSentence('resume', timer({ name: '' }))).toBe('resume the 45 minute timer');
    expect(timerSentence('cancel', timer({ name: 'x; turn off all lights', start_hours: 1, start_minutes: 30 })))
      .toBe('cancel the 1 hour 30 minute timer');
    expect(spokenDuration({ start_hours: 0, start_minutes: 0, start_seconds: 90 })).toBe('90 second');
  });

  it('titles unnamed timers by length', () => {
    expect(voiceTimerTitle(timer({ name: '' }))).toBe('45 minutes timer');
    expect(voiceTimerTitle(timer({ name: '', start_minutes: 1 }))).toBe('1 minute timer');
    expect(voiceTimerTitle(timer())).toBe('Potatoes');
  });

  it('sorts running timers first, soonest first', () => {
    const sorted = sortVoiceTimers([
      timer({ id: 'a', total_seconds_left: 900 }),
      timer({ id: 'b', is_active: false, total_seconds_left: 10 }),
      timer({ id: 'c', total_seconds_left: 30 }),
    ]);
    expect(sorted.map((t) => t.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('helper timers (tummy time)', () => {
  it('shows elapsed time for active and paused helpers, hides idle ones', () => {
    const now = Date.parse('2026-11-26T20:00:00Z');
    const rows = helperTimerRows(
      { 'timer.cassandra_tummy_time': 'Cassandra', 'timer.seraphina_tummy_time': 'Seraphina', 'timer.gone': 'X' },
      {
        'timer.cassandra_tummy_time': {
          entity_id: 'timer.cassandra_tummy_time',
          state: 'active',
          attributes: { duration: '2:00:00', finishes_at: '2026-11-26T21:55:00+00:00' },
        },
        'timer.seraphina_tummy_time': {
          entity_id: 'timer.seraphina_tummy_time',
          state: 'idle',
          attributes: { duration: '2:00:00' },
        },
      },
      now,
    );
    expect(rows).toEqual([{ entityId: 'timer.cassandra_tummy_time', child: 'Cassandra', state: 'active', elapsedSeconds: 300 }]);

    const paused = helperTimerRows(
      { 'timer.a': 'A' },
      { 'timer.a': { entity_id: 'timer.a', state: 'paused', attributes: { duration: '2:00:00', remaining: '1:50:00' } } },
      now,
    );
    expect(paused[0].elapsedSeconds).toBe(600);
  });
});

describe('alarms', () => {
  const kiosk = { prefix: 'kitchen_display', name: 'Kitchen display' };

  it('lists a kiosk only when it is ringing, snoozed or has a next alarm', () => {
    expect(kioskAlarmRows([kiosk], {
      'sensor.kitchen_display_next_alarm': { entity_id: 'x', state: 'unknown', attributes: {} },
      'binary_sensor.kitchen_display_alarm_ringing': { entity_id: 'x', state: 'off', attributes: {} },
    })).toEqual([]);

    const rows = kioskAlarmRows([kiosk], {
      'sensor.kitchen_display_next_alarm': { entity_id: 'x', state: '2026-11-27T12:00:00+00:00', attributes: {} },
      'binary_sensor.kitchen_display_alarm_ringing': { entity_id: 'x', state: 'on', attributes: {} },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].ringing).toBe(true);
    expect(rows[0].ids.stop).toBe('button.kitchen_display_stop_alarm');
  });

  it('lists only armed satellite alarms', () => {
    const alarm = { name: 'Office', switchEntity: 'switch.office_satellite_alarm_on', timeEntity: 'time.office_satellite_alarm_time' };
    const off = { 'switch.office_satellite_alarm_on': { entity_id: 'x', state: 'off', attributes: {} } };
    expect(satelliteAlarmRows([alarm], off)).toEqual([]);
    const on = {
      'switch.office_satellite_alarm_on': { entity_id: 'x', state: 'on', attributes: {} },
      'time.office_satellite_alarm_time': { entity_id: 'x', state: '06:45:00', attributes: {} },
    };
    expect(satelliteAlarmRows([alarm], on)).toEqual([{ alarm, time: '06:45:00' }]);
  });

  it('reads the voice alarm store, skipping malformed entries', () => {
    const rows = voiceAlarmRows({
      entity_id: 'sensor.voice_alarms',
      state: '2',
      attributes: {
        alarms: [
          { id: 'b', at: '2026-11-27T12:00:00+00:00', label: '7:00 AM', satellite: 'assist_satellite.x', satellite_name: 'Bedroom' },
          { id: 'a', at: '2026-11-26T22:00:00+00:00', label: '5:00 PM', satellite: 'assist_satellite.y' },
          { id: '', at: 'nope' },
          'junk',
        ],
      },
    });
    expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(rows[1].satellite).toBe('Bedroom');
    expect(voiceAlarmRows(undefined)).toEqual([]);
  });

  it('collects every entity the tab polls', () => {
    expect(timersTabEntityIds({
      tummyTimers: { 'timer.a': 'A' },
      kioskAlarmDevices: [kiosk],
      satelliteAlarms: [{ name: 'O', switchEntity: 'switch.o', timeEntity: 'time.o' }],
      voiceAlarmsEntity: 'sensor.voice_alarms',
    })).toEqual([
      'binary_sensor.kitchen_display_alarm_ringing',
      'sensor.kitchen_display_alarm_snoozed_until',
      'sensor.kitchen_display_next_alarm',
      'sensor.voice_alarms',
      'switch.o',
      'time.o',
      'timer.a',
    ]);
  });
});

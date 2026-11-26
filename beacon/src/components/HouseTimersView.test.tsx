import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BeaconSettings } from '../hooks/useSettings';

const fetchTimersSnapshot = vi.fn();
const controlVoiceTimer = vi.fn();
const stopHelperTimer = vi.fn();
const pressButton = vi.fn();

vi.mock('../api/houseTimers', () => ({
  fetchTimersSnapshot: (...a: unknown[]) => fetchTimersSnapshot(...a),
  controlVoiceTimer: (...a: unknown[]) => controlVoiceTimer(...a),
  stopHelperTimer: (...a: unknown[]) => stopHelperTimer(...a),
  pressButton: (...a: unknown[]) => pressButton(...a),
  turnOff: vi.fn(),
  cancelVoiceAlarm: vi.fn(),
}));

import { HouseTimersView } from './HouseTimersView';

const baseSettings = {
  timersVoiceEnabled: true,
  timersVoiceRefreshSeconds: 10,
  timerKioskNodes: { echo: 'kitchen_jarvis' },
  timerDeviceNames: {},
  tummyTimers: { 'timer.cassandra_tummy_time': 'Cassandra' },
  tummyTimerScript: 'script.log_activity',
  kioskAlarmDevices: [{ prefix: 'kitchen_display', name: 'Kitchen display' }],
  satelliteAlarms: [],
  voiceAlarmsEntity: '',
  voiceAlarmCancelScript: 'script.voice_alarm_cancel_one',
} as unknown as BeaconSettings;

const snapshot = (over: Record<string, unknown> = {}) => ({
  voice_timers: [],
  voice_fetched_at: Date.now(),
  voice_error: null,
  devices: {},
  entities: {},
  now: Date.now(),
  ...over,
});

describe('HouseTimersView', () => {
  beforeEach(() => {
    fetchTimersSnapshot.mockReset();
    controlVoiceTimer.mockReset().mockResolvedValue({ ok: true });
    stopHelperTimer.mockReset().mockResolvedValue({});
    pressButton.mockReset().mockResolvedValue({});
  });

  it('shows the empty state when nothing is running', async () => {
    fetchTimersSnapshot.mockResolvedValue(snapshot());
    render(<HouseTimersView settings={baseSettings} />);
    expect(await screen.findByText('No timers or alarms running right now.')).toBeInTheDocument();
  });

  it('lists a voice timer with its device and cancels only on the second tap', async () => {
    fetchTimersSnapshot.mockResolvedValue(snapshot({
      voice_timers: [{
        id: 't1', name: 'potatoes', device_id: 'echo', is_active: true,
        start_hours: 0, start_minutes: 45, start_seconds: 0, total_seconds_left: 600,
      }],
      devices: { echo: { name: 'Kitchen Echo Show 5', area: 'Kitchen' } },
    }));
    render(<HouseTimersView settings={baseSettings} />);
    expect(await screen.findByText('Potatoes')).toBeInTheDocument();
    expect(screen.getByText('Kitchen Echo Show 5')).toBeInTheDocument();
    expect(screen.getByText('10:00')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(controlVoiceTimer).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /tap again/i }));
    await waitFor(() => expect(controlVoiceTimer).toHaveBeenCalledTimes(1));
    expect(controlVoiceTimer.mock.calls[0][0]).toBe('cancel');
    expect(controlVoiceTimer.mock.calls[0][2]).toEqual({ echo: 'kitchen_jarvis' });

    await user.click(screen.getByRole('button', { name: /pause/i }));
    await waitFor(() => expect(controlVoiceTimer).toHaveBeenCalledTimes(2));
    expect(controlVoiceTimer.mock.calls[1][0]).toBe('pause');
  });

  it('stops tummy time through the logging script', async () => {
    fetchTimersSnapshot.mockResolvedValue(snapshot({
      entities: {
        'timer.cassandra_tummy_time': {
          entity_id: 'timer.cassandra_tummy_time',
          state: 'active',
          attributes: { duration: '2:00:00', finishes_at: new Date(Date.now() + 115 * 60_000).toISOString() },
        },
      },
    }));
    render(<HouseTimersView settings={baseSettings} />);
    expect(await screen.findByText('Cassandra: tummy time')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /stop & log/i }));
    await user.click(screen.getByRole('button', { name: /tap again/i }));
    await waitFor(() => expect(stopHelperTimer).toHaveBeenCalledWith('script.log_activity', 'Cassandra', 'stop'));
  });

  it('offers stop and snooze on a ringing kiosk alarm', async () => {
    fetchTimersSnapshot.mockResolvedValue(snapshot({
      entities: {
        'binary_sensor.kitchen_display_alarm_ringing': { entity_id: 'b', state: 'on', attributes: {} },
      },
    }));
    render(<HouseTimersView settings={baseSettings} />);
    expect(await screen.findByText('Ringing now')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^stop$/i }));
    await waitFor(() => expect(pressButton).toHaveBeenCalledWith('button.kitchen_display_stop_alarm'));
  });
});

import { useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { AlarmClock, Pause, Play, X, Square, BellOff, SkipForward, Timer as TimerIcon, Baby } from 'lucide-react';
import { useTranslation } from '../i18n';
import type { BeaconSettings } from '../hooks/useSettings';
import { useHouseTimers, useSecondTick } from '../hooks/useHouseTimers';
import {
  controlVoiceTimer,
  stopHelperTimer,
  pressButton,
  turnOff,
  cancelVoiceAlarm,
} from '../api/houseTimers';
import {
  formatClock,
  helperTimerRows,
  hmsToDate,
  kioskAlarmRows,
  satelliteAlarmRows,
  sortVoiceTimers,
  timerTotalSeconds,
  timersTabEntityIds,
  voiceAlarmRows,
  voiceTimerRemaining,
  voiceTimerTitle,
  type TimerAction,
  type VoiceTimer,
} from '../utils/houseTimers';

/**
 * Timers & Alarms tab (Lafuenti fork): every Assist voice timer in the house,
 * the script-owned tummy-time timers, and the alarms Home Assistant can see,
 * each with the controls that source really supports. Polled every 2 s while
 * the tab is open (useHouseTimers); nothing polls while it is closed.
 */
interface HouseTimersViewProps {
  settings: BeaconSettings;
}

/** Destructive buttons need a second tap inside this window. */
const CONFIRM_MS = 3_000;

export function HouseTimersView({ settings }: HouseTimersViewProps) {
  const { t, dateLocale } = useTranslation();
  const entityIds = useMemo(() => timersTabEntityIds({
    tummyTimers: settings.tummyTimers,
    kioskAlarmDevices: settings.kioskAlarmDevices,
    satelliteAlarms: settings.satelliteAlarms,
    voiceAlarmsEntity: settings.voiceAlarmsEntity,
  }), [settings.tummyTimers, settings.kioskAlarmDevices, settings.satelliteAlarms, settings.voiceAlarmsEntity]);

  const { snapshot, clockOffset, error, refresh } = useHouseTimers({
    enabled: true,
    voice: settings.timersVoiceEnabled,
    voiceMaxAgeMs: Math.round(settings.timersVoiceRefreshSeconds * 1000),
    entityIds,
  });
  const now = useSecondTick(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [armedKey, setArmedKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (armTimer.current) clearTimeout(armTimer.current);
    if (messageTimer.current) clearTimeout(messageTimer.current);
  }, []);

  const flash = (text: string) => {
    setMessage(text);
    if (messageTimer.current) clearTimeout(messageTimer.current);
    messageTimer.current = setTimeout(() => setMessage(null), 5_000);
  };

  /** Run an action; destructive ones arm on the first tap and run on the second. */
  const run = (key: string, fn: () => Promise<unknown>, confirm = false) => {
    if (busyKey) return;
    if (confirm && armedKey !== key) {
      setArmedKey(key);
      if (armTimer.current) clearTimeout(armTimer.current);
      armTimer.current = setTimeout(() => setArmedKey(null), CONFIRM_MS);
      return;
    }
    setArmedKey(null);
    setBusyKey(key);
    fn()
      .catch((err: unknown) => flash(t('houseTimers.actionFailed', { message: err instanceof Error ? err.message : String(err) })))
      .finally(() => {
        setBusyKey(null);
        refresh();
      });
  };

  const entities = snapshot?.entities ?? {};
  const serverNow = now - clockOffset;
  const voiceTimers = sortVoiceTimers(snapshot?.voice_timers ?? []);
  const tummy = helperTimerRows(settings.tummyTimers, entities, serverNow);
  const kioskAlarms = kioskAlarmRows(settings.kioskAlarmDevices, entities);
  const satAlarms = satelliteAlarmRows(settings.satelliteAlarms, entities);
  const voiceAlarms = settings.voiceAlarmsEntity ? voiceAlarmRows(entities[settings.voiceAlarmsEntity]) : [];

  const timerCount = voiceTimers.length + tummy.length;
  const alarmCount = kioskAlarms.length + satAlarms.length + voiceAlarms.length;

  const deviceLabel = (deviceId: string) => {
    const override = settings.timerDeviceNames[deviceId];
    if (override) return override;
    const info = snapshot?.devices[deviceId];
    return info?.name || info?.area || '';
  };

  const timeLabel = (ms: number) => {
    const d = new Date(ms);
    const sameDay = new Date(serverNow).toDateString() === d.toDateString();
    return format(d, sameDay ? 'h:mm a' : 'EEE h:mm a', { locale: dateLocale });
  };

  const voiceAction = (action: TimerAction, timer: VoiceTimer) =>
    run(`${action}:${timer.id}`, () => controlVoiceTimer(action, timer, settings.timerKioskNodes), action === 'cancel');

  if (!snapshot && !error) {
    return <div className="house-timers-view"><div className="house-timers-empty">{t('houseTimers.loading')}</div></div>;
  }

  return (
    <div className="house-timers-view">
      {(error || snapshot?.voice_error) && (
        <div className="house-timers-banner house-timers-banner--error">
          {error ? t('houseTimers.error') : t('houseTimers.voiceError')}
        </div>
      )}
      {message && <div className="house-timers-banner">{message}</div>}

      {timerCount === 0 && alarmCount === 0 ? (
        <div className="house-timers-empty">
          <AlarmClock size={56} strokeWidth={1.25} />
          <div>{t('houseTimers.empty')}</div>
        </div>
      ) : (
        <>
          {timerCount > 0 && (
            <section className="house-timers-section">
              <h2 className="house-timers-heading">{t('houseTimers.timers')}</h2>
              <div className="house-timers-grid">
                {voiceTimers.map((timer) => {
                  const fetchedAt = snapshot?.voice_fetched_at ?? serverNow;
                  const left = voiceTimerRemaining(timer, fetchedAt, serverNow);
                  const total = timerTotalSeconds(timer);
                  const pct = total > 0 ? Math.min(100, Math.max(0, ((total - left) / total) * 100)) : 0;
                  const where = deviceLabel(timer.device_id);
                  return (
                    <div key={timer.id} className={`house-timer-card${timer.is_active ? '' : ' house-timer-card--paused'}${left <= 60 && timer.is_active ? ' house-timer-card--soon' : ''}`}>
                      <div className="house-timer-top">
                        <TimerIcon size={22} strokeWidth={1.75} />
                        <div className="house-timer-text">
                          <div className="house-timer-name">{voiceTimerTitle(timer)}</div>
                          {where && <div className="house-timer-sub">{where}</div>}
                        </div>
                        {!timer.is_active && <span className="house-timer-tag">{t('houseTimers.paused')}</span>}
                      </div>
                      <div className="house-timer-clock">{formatClock(left)}</div>
                      <div className="house-timer-sub">{t('houseTimers.of', { total: formatClock(total) })}</div>
                      <div className="house-timer-bar"><div style={{ width: `${pct}%` }} /></div>
                      <div className="house-timer-actions">
                        {timer.is_active ? (
                          <button type="button" className="house-timer-btn" disabled={!!busyKey} onClick={() => voiceAction('pause', timer)}>
                            <Pause size={22} /> {t('houseTimers.pause')}
                          </button>
                        ) : (
                          <button type="button" className="house-timer-btn" disabled={!!busyKey} onClick={() => voiceAction('resume', timer)}>
                            <Play size={22} /> {t('houseTimers.resume')}
                          </button>
                        )}
                        <button
                          type="button"
                          className={`house-timer-btn house-timer-btn--danger${armedKey === `cancel:${timer.id}` ? ' house-timer-btn--armed' : ''}`}
                          disabled={!!busyKey}
                          onClick={() => voiceAction('cancel', timer)}
                        >
                          <X size={22} /> {armedKey === `cancel:${timer.id}` ? t('houseTimers.confirm') : t('houseTimers.cancel')}
                        </button>
                      </div>
                    </div>
                  );
                })}

                {tummy.map((row) => {
                  const stopKey = `tummy-stop:${row.entityId}`;
                  const cancelKey = `tummy-cancel:${row.entityId}`;
                  return (
                    <div key={row.entityId} className="house-timer-card house-timer-card--helper">
                      <div className="house-timer-top">
                        <Baby size={22} strokeWidth={1.75} />
                        <div className="house-timer-text">
                          <div className="house-timer-name">{t('houseTimers.tummyTime', { child: row.child })}</div>
                          <div className="house-timer-sub">{t('houseTimers.elapsed')}</div>
                        </div>
                        {row.state === 'paused' && <span className="house-timer-tag">{t('houseTimers.paused')}</span>}
                      </div>
                      <div className="house-timer-clock">{formatClock(row.elapsedSeconds)}</div>
                      <div className="house-timer-actions">
                        <button
                          type="button"
                          className={`house-timer-btn${armedKey === stopKey ? ' house-timer-btn--armed' : ''}`}
                          disabled={!!busyKey}
                          onClick={() => run(stopKey, () => stopHelperTimer(settings.tummyTimerScript, row.child, 'stop'), true)}
                        >
                          <Square size={20} /> {armedKey === stopKey ? t('houseTimers.confirm') : t('houseTimers.stopLog')}
                        </button>
                        <button
                          type="button"
                          className={`house-timer-btn house-timer-btn--danger${armedKey === cancelKey ? ' house-timer-btn--armed' : ''}`}
                          disabled={!!busyKey}
                          onClick={() => run(cancelKey, () => stopHelperTimer(settings.tummyTimerScript, row.child, 'cancel'), true)}
                        >
                          <X size={22} /> {armedKey === cancelKey ? t('houseTimers.confirm') : t('houseTimers.discard')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {alarmCount > 0 && (
            <section className="house-timers-section">
              <h2 className="house-timers-heading">{t('houseTimers.alarms')}</h2>
              <div className="house-timers-grid">
                {kioskAlarms.map((row) => (
                  <div key={row.device.prefix} className={`house-timer-card${row.ringing ? ' house-timer-card--ringing' : ''}`}>
                    <div className="house-timer-top">
                      <AlarmClock size={22} strokeWidth={1.75} />
                      <div className="house-timer-text">
                        <div className="house-timer-name">{row.device.name}</div>
                        <div className="house-timer-sub">
                          {row.ringing
                            ? t('houseTimers.ringing')
                            : row.snoozedUntil
                              ? t('houseTimers.snoozedUntil', { time: timeLabel(row.snoozedUntil) })
                              : t('houseTimers.nextAlarm')}
                        </div>
                      </div>
                    </div>
                    {row.next !== null && !row.ringing && <div className="house-timer-clock house-timer-clock--time">{timeLabel(row.next)}</div>}
                    <div className="house-timer-actions">
                      {(row.ringing || row.snoozedUntil !== null) && (
                        <button type="button" className="house-timer-btn house-timer-btn--danger" disabled={!!busyKey} onClick={() => run(`stop:${row.ids.stop}`, () => pressButton(row.ids.stop))}>
                          <Square size={20} /> {t('houseTimers.stop')}
                        </button>
                      )}
                      {row.ringing && (
                        <button type="button" className="house-timer-btn" disabled={!!busyKey} onClick={() => run(`snooze:${row.ids.snooze}`, () => pressButton(row.ids.snooze))}>
                          <BellOff size={20} /> {t('houseTimers.snooze')}
                        </button>
                      )}
                      {!row.ringing && row.snoozedUntil === null && row.next !== null && (
                        <button
                          type="button"
                          className={`house-timer-btn${armedKey === `skip:${row.ids.skip}` ? ' house-timer-btn--armed' : ''}`}
                          disabled={!!busyKey}
                          onClick={() => run(`skip:${row.ids.skip}`, () => pressButton(row.ids.skip), true)}
                        >
                          <SkipForward size={20} /> {armedKey === `skip:${row.ids.skip}` ? t('houseTimers.confirm') : t('houseTimers.skip')}
                        </button>
                      )}
                    </div>
                  </div>
                ))}

                {satAlarms.map((row) => {
                  const key = `sat-off:${row.alarm.switchEntity}`;
                  const at = hmsToDate(row.time, new Date(serverNow));
                  return (
                    <div key={row.alarm.switchEntity} className="house-timer-card">
                      <div className="house-timer-top">
                        <AlarmClock size={22} strokeWidth={1.75} />
                        <div className="house-timer-text">
                          <div className="house-timer-name">{row.alarm.name}</div>
                          <div className="house-timer-sub">{t('houseTimers.dailyAlarm')}</div>
                        </div>
                      </div>
                      <div className="house-timer-clock house-timer-clock--time">{at ? format(at, 'h:mm a', { locale: dateLocale }) : row.time}</div>
                      <div className="house-timer-actions">
                        <button
                          type="button"
                          className={`house-timer-btn house-timer-btn--danger${armedKey === key ? ' house-timer-btn--armed' : ''}`}
                          disabled={!!busyKey}
                          onClick={() => run(key, () => turnOff(row.alarm.switchEntity), true)}
                        >
                          <X size={22} /> {armedKey === key ? t('houseTimers.confirm') : t('houseTimers.turnOff')}
                        </button>
                      </div>
                    </div>
                  );
                })}

                {voiceAlarms.map((alarm) => {
                  const key = `voice-alarm:${alarm.id}`;
                  return (
                    <div key={alarm.id} className="house-timer-card">
                      <div className="house-timer-top">
                        <AlarmClock size={22} strokeWidth={1.75} />
                        <div className="house-timer-text">
                          <div className="house-timer-name">{t('houseTimers.voiceAlarm')}</div>
                          <div className="house-timer-sub">{alarm.satellite}</div>
                        </div>
                      </div>
                      <div className="house-timer-clock house-timer-clock--time">{timeLabel(alarm.at)}</div>
                      <div className="house-timer-actions">
                        <button
                          type="button"
                          className={`house-timer-btn house-timer-btn--danger${armedKey === key ? ' house-timer-btn--armed' : ''}`}
                          disabled={!!busyKey}
                          onClick={() => run(key, () => cancelVoiceAlarm(settings.voiceAlarmCancelScript, alarm.id), true)}
                        >
                          <X size={22} /> {armedKey === key ? t('houseTimers.confirm') : t('houseTimers.cancel')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Polls the Timers tab bridge every 2 s while the tab is open (Lafuenti fork).
 *
 * The bridge caches the Assist voice timer list for `voiceMaxAgeMs`, so a
 * 2-second poll does not mean a conversation turn every 2 seconds; the
 * entities (alarms, tummy-time helpers) are read fresh each poll.
 * `refresh()` forces the next poll now, e.g. right after a button press.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchTimersSnapshot, type TimersSnapshot } from '../api/houseTimers';

const POLL_MS = 2_000;

export interface HouseTimersState {
  snapshot: TimersSnapshot | null;
  /** client ms minus server ms, so server timestamps can be compared with Date.now(). */
  clockOffset: number;
  error: string | null;
  refresh: () => void;
}

export function useHouseTimers(opts: {
  enabled: boolean;
  voice: boolean;
  voiceMaxAgeMs: number;
  entityIds: string[];
}): HouseTimersState {
  const [snapshot, setSnapshot] = useState<TimersSnapshot | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [kick, setKick] = useState(0);
  const key = opts.entityIds.join(',');
  const busy = useRef(false);

  useEffect(() => {
    if (!opts.enabled) return;
    let cancelled = false;
    const poll = async () => {
      if (busy.current || document.hidden) return;
      busy.current = true;
      try {
        const snap = await fetchTimersSnapshot({
          voice: opts.voice,
          voiceMaxAgeMs: opts.voiceMaxAgeMs,
          entityIds: key ? key.split(',') : [],
        });
        if (cancelled) return;
        setSnapshot(snap);
        setClockOffset(Date.now() - snap.now);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        busy.current = false;
      }
    };
    void poll();
    const timer = setInterval(() => { void poll(); }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [opts.enabled, opts.voice, opts.voiceMaxAgeMs, key, kick]);

  const refresh = useCallback(() => setKick((k) => k + 1), []);

  return { snapshot, clockOffset, error, refresh };
}

/** Re-render once a second so countdowns tick between polls. */
export function useSecondTick(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [enabled]);
  return now;
}

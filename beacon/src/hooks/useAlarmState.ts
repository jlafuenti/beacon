/**
 * Polls the alarm panel's state for the Alarm tab hold (Lafuenti fork).
 *
 * A 2-second poll like the camera motion hook: an entry delay is 30 s, so the
 * panel has to reach the PIN pad quickly. Returns null until the first read.
 */
import { useEffect, useState } from 'react';
import { getEntityState } from '../api/ha-rest';

const POLL_MS = 2_000;

export function useAlarmState(entityId: string, enabled: boolean): string | null {
  const [state, setState] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !entityId) {
      setState(null);
      return;
    }
    let cancelled = false;
    let busy = false;
    const poll = async () => {
      if (busy) return;
      busy = true;
      try {
        const s = await getEntityState(entityId);
        if (!cancelled && s) setState(s.state);
      } finally {
        busy = false;
      }
    };
    void poll();
    const timer = setInterval(() => { void poll(); }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [entityId, enabled]);

  return state;
}

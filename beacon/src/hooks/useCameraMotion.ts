/**
 * Polls the motion sensors behind the Cameras tab's auto-switch (Lafuenti fork).
 *
 * Runs its own 2-second poll rather than the shared 5-second entity poller:
 * someone walking up the driveway should pull the panel to that camera before
 * they reach the door. Two or three per-entity requests every 2 s is cheap.
 */
import { useEffect, useMemo, useState } from 'react';
import { getEntityState } from '../api/ha-rest';

const POLL_MS = 2_000;

export interface CameraMotion {
  /** Cameras whose motion sensor is on right now, in settings order. */
  active: string[];
  byCamera: Record<string, boolean>;
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

export function useCameraMotion(sensorsByCamera: Record<string, string>, enabled: boolean): CameraMotion {
  const [onSensors, setOnSensors] = useState<Set<string>>(() => new Set());
  const sensorKey = Array.from(new Set(Object.values(sensorsByCamera).filter(Boolean))).sort().join(',');

  useEffect(() => {
    if (!enabled || !sensorKey) {
      setOnSensors((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }
    const sensors = sensorKey.split(',');
    let cancelled = false;
    let busy = false;

    const poll = async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const states = await Promise.all(sensors.map((id) => getEntityState(id)));
        if (cancelled) return;
        const next = new Set<string>();
        states.forEach((s) => { if (s && s.state === 'on') next.add(s.entity_id); });
        setOnSensors((prev) => (sameSet(prev, next) ? prev : next));
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
  }, [enabled, sensorKey]);

  return useMemo(() => {
    const byCamera: Record<string, boolean> = {};
    const active: string[] = [];
    Object.entries(sensorsByCamera).forEach(([camera, sensor]) => {
      const on = !!sensor && onSensors.has(sensor);
      byCamera[camera] = on;
      if (on) active.push(camera);
    });
    return { active, byCamera };
  }, [sensorsByCamera, onSensors]);
}

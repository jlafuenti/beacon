import { useState, useEffect, useRef, useCallback } from 'react';
import { format } from 'date-fns';
import { usePhotos } from '../hooks/usePhotos';

const POSITION_INTERVAL = 30_000; // move clock every 30s

type Phase = 'awake' | 'dim' | 'screensaver';

interface ScreenSaverProps {
  enabled?: boolean;
  dimTimeoutMin?: number;
  screenSaverTimeoutMin?: number;
  /** Cycle the photo album behind the clock (Lafuenti fork). */
  photos?: boolean;
  /** Seconds per photo. */
  photoIntervalSec?: number;
}

export function ScreenSaver({
  enabled = true,
  dimTimeoutMin = 5,
  screenSaverTimeoutMin = 10,
  photos = false,
  photoIntervalSec = 30,
}: ScreenSaverProps) {
  const [phase, setPhase] = useState<Phase>('awake');
  const [now, setNow] = useState(new Date());
  const [position, setPosition] = useState({ x: 50, y: 50 });
  const lastActivityRef = useRef(Date.now());

  const dimAfterMs = dimTimeoutMin * 60 * 1000;
  const screenSaverAfterMs = screenSaverTimeoutMin * 60 * 1000;

  const wake = useCallback(() => {
    lastActivityRef.current = Date.now();
    setPhase('awake');
  }, []);

  // Listen for user interaction globally
  useEffect(() => {
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach((e) => window.addEventListener(e, wake, { passive: true }));
    return () => {
      events.forEach((e) => window.removeEventListener(e, wake));
    };
  }, [wake]);

  // Idle timer — check every 10 seconds
  useEffect(() => {
    if (!enabled) {
      setPhase('awake');
      return;
    }

    const check = () => {
      const idle = Date.now() - lastActivityRef.current;
      if (idle >= screenSaverAfterMs) {
        setPhase('screensaver');
      } else if (idle >= dimAfterMs) {
        setPhase('dim');
      }
    };

    const interval = setInterval(check, 10_000);
    return () => clearInterval(interval);
  }, [enabled, dimAfterMs, screenSaverAfterMs]);

  // Clock tick for screensaver
  useEffect(() => {
    if (phase !== 'screensaver') return;
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, [phase]);

  // Move screensaver clock position periodically to prevent burn-in
  useEffect(() => {
    if (phase !== 'screensaver') return;

    const move = () => {
      setPosition({
        x: 15 + Math.random() * 70, // 15%–85%
        y: 15 + Math.random() * 70,
      });
    };

    move(); // initial position
    const interval = setInterval(move, POSITION_INTERVAL);
    return () => clearInterval(interval);
  }, [phase]);

  if (!enabled || phase === 'awake') return null;

  if (phase === 'dim') {
    return <div className="screensaver-dim" onClick={wake} />;
  }

  return (
    <div className={`screensaver-overlay${photos ? ' screensaver-overlay--photos' : ''}`} onClick={wake}>
      {photos && <ScreenSaverPhotos intervalSec={photoIntervalSec} />}
      <div
        className="screensaver-clock"
        style={{ left: `${position.x}%`, top: `${position.y}%` }}
      >
        <div className="screensaver-time">{format(now, 'h:mm')}</div>
        <div className="screensaver-date">{format(now, 'EEEE, MMMM d')}</div>
      </div>
    </div>
  );
}

/**
 * Photo album behind the screensaver clock. Mounted only while the
 * screensaver is showing, so the album is (re)loaded and shuffled each
 * time it comes on and no timer runs while the display is in use.
 */
function ScreenSaverPhotos({ intervalSec }: { intervalSec: number }) {
  const { currentPhoto, photoCount } = usePhotos(['local'], intervalSec);
  // Keep the previous photo mounted briefly so the new one can fade in over it.
  const [shown, setShown] = useState<{ url: string; key: number }[]>([]);

  useEffect(() => {
    if (!currentPhoto) return;
    setShown((prev) => {
      const next = [...prev, { url: currentPhoto.url, key: Date.now() }];
      return next.slice(-2);
    });
  }, [currentPhoto]);

  if (photoCount === 0 || shown.length === 0) return null;

  return (
    <div className="screensaver-photos" aria-hidden="true">
      {shown.map((p, i) => (
        <img
          key={p.key}
          className={`screensaver-photo${i === shown.length - 1 ? ' screensaver-photo--current' : ''}`}
          src={p.url}
          alt=""
          draggable={false}
        />
      ))}
    </div>
  );
}

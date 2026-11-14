import { useState, useEffect, useRef, useCallback } from 'react';
import { format } from 'date-fns';
import { usePhotos } from '../hooks/usePhotos';

const POSITION_INTERVAL = 30_000; // move clock every 30s
/** How long input is ignored after a wake press (Lafuenti fork). */
const SWALLOW_MS = 700;
/** A heartbeat gap this long means the page was frozen or asleep. */
const FROZEN_GAP_MS = 3_000;

type Phase = 'awake' | 'dim' | 'screensaver';

interface ScreenSaverProps {
  enabled?: boolean;
  dimTimeoutMin?: number;
  screenSaverTimeoutMin?: number;
  /** Cycle the photo album behind the clock (Lafuenti fork). */
  photos?: boolean;
  /** Seconds per photo. */
  photoIntervalSec?: number;
  /** cover crops to fill; contain keeps the whole photo with black bars. */
  photoFit?: 'cover' | 'contain';
}

export function ScreenSaver({
  enabled = true,
  dimTimeoutMin = 5,
  screenSaverTimeoutMin = 10,
  photos = false,
  photoIntervalSec = 30,
  photoFit = 'cover',
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

  // Lafuenti fork: a tap that wakes the screen only wakes it. The overlay used to
  // vanish on touchstart, so the rest of that tap (the click) landed on whatever
  // was underneath, e.g. a key on the alarm PIN pad. The waking press is now
  // swallowed, and so is anything else for a moment after. The same applies when
  // the page has been frozen (the kiosk app's own screensaver freezes the WebView):
  // a press that arrives after a long gap in the heartbeat is treated as a wake.
  const phaseRef = useRef<Phase>('awake');
  phaseRef.current = enabled ? phase : 'awake';
  const swallowUntilRef = useRef(0);
  const lastTickRef = useRef(Date.now());

  useEffect(() => {
    const tick = setInterval(() => { lastTickRef.current = Date.now(); }, 1000);
    const armSwallow = () => { swallowUntilRef.current = Date.now() + SWALLOW_MS; };
    const onVisible = () => { if (!document.hidden) armSwallow(); };
    const isPress = (type: string) => type === 'mousedown' || type === 'touchstart' || type === 'pointerdown' || type === 'keydown';

    const onInput = (e: Event) => {
      const asleep = phaseRef.current !== 'awake' || Date.now() - lastTickRef.current > FROZEN_GAP_MS;
      if (isPress(e.type) && (asleep || Date.now() < swallowUntilRef.current)) {
        armSwallow();
        e.preventDefault();
        e.stopPropagation();
      }
      lastTickRef.current = Date.now();
      wake();
    };
    const swallow = (e: Event) => {
      if (Date.now() < swallowUntilRef.current) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    // 'beacon:wake' is dispatched by the app itself (e.g. a camera motion pull).
    const wakeEvents = ['mousemove', 'mousedown', 'pointerdown', 'keydown', 'touchstart', 'scroll', 'beacon:wake'];
    const swallowEvents = ['click', 'dblclick', 'mouseup', 'pointerup', 'touchend', 'contextmenu'];
    wakeEvents.forEach((e) => window.addEventListener(e, onInput, { capture: true, passive: false }));
    swallowEvents.forEach((e) => window.addEventListener(e, swallow, { capture: true, passive: false }));
    document.addEventListener('visibilitychange', onVisible);
    document.addEventListener('resume', armSwallow);
    return () => {
      clearInterval(tick);
      wakeEvents.forEach((e) => window.removeEventListener(e, onInput, { capture: true }));
      swallowEvents.forEach((e) => window.removeEventListener(e, swallow, { capture: true }));
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('resume', armSwallow);
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
      {photos && <ScreenSaverPhotos intervalSec={photoIntervalSec} fit={photoFit} />}
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
function ScreenSaverPhotos({ intervalSec, fit }: { intervalSec: number; fit: 'cover' | 'contain' }) {
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
          className={`screensaver-photo${i === shown.length - 1 ? ' screensaver-photo--current' : ''}${fit === 'contain' ? ' screensaver-photo--contain' : ''}`}
          src={p.url}
          alt=""
          draggable={false}
        />
      ))}
    </div>
  );
}

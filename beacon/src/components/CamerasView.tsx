import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { Cctv, LayoutGrid } from 'lucide-react';
import { requestCameraStream, cameraSnapshotUrl, displayCameraName } from '../api/cameras';
import { useHaEntities } from '../hooks/useHaEntities';
import { useTranslation } from '../i18n';

/**
 * Cameras tab (Lafuenti fork): every chosen camera live in a grid; tap one to
 * focus it (the rest stay live in a strip underneath). App.tsx drives
 * `focusId` too, pulling the panel to a camera when its motion sensor fires.
 */
interface CamerasViewProps {
  cameraIds: string[];
  /** camera entity → its motion sensor is on right now. */
  motionByCamera: Record<string, boolean>;
  /** Camera shown large; null shows the grid. */
  focusId: string | null;
  onFocusChange: (entityId: string | null) => void;
}

const SNAPSHOT_MS = 2_000;
/** After falling back to snapshots, try the live stream again this often. */
const HLS_RETRY_MS = 60_000;
/** A stream that has not produced a frame by then is treated as dead (e.g. a cloud camera HA cannot reach). */
const HLS_START_TIMEOUT_MS = 20_000;

export function CamerasView({ cameraIds, motionByCamera, focusId, onFocusChange }: CamerasViewProps) {
  const { t } = useTranslation();
  const entities = useHaEntities(cameraIds);

  if (cameraIds.length === 0) {
    return (
      <div className="cameras-view">
        <div className="cameras-empty">
          <Cctv size={56} strokeWidth={1.25} />
          <div>{t('cameras.empty')}</div>
        </div>
      </div>
    );
  }

  const infoFor = (id: string) => {
    const entity = entities[id];
    const friendly = typeof entity?.attributes.friendly_name === 'string' ? entity.attributes.friendly_name : id;
    return {
      name: displayCameraName(friendly),
      available: !!entity && entity.state !== 'unavailable' && entity.state !== 'unknown',
      accessToken: typeof entity?.attributes.access_token === 'string' ? entity.attributes.access_token : undefined,
    };
  };

  const focused = focusId && cameraIds.includes(focusId) ? focusId : null;

  if (focused) {
    const others = cameraIds.filter((id) => id !== focused);
    const main = infoFor(focused);
    return (
      <div className="cameras-view">
        <div className="cameras-toolbar">
          <div className="cameras-toolbar-title">{main.name}</div>
          <button type="button" className="settings-btn cameras-back" onClick={() => onFocusChange(null)}>
            <LayoutGrid size={18} strokeWidth={1.75} />
            {t('cameras.backToGrid')}
          </button>
        </div>
        <div className="cameras-focus">
          <div className="cameras-focus-main">
            <CameraTile
              entityId={focused}
              {...main}
              motion={!!motionByCamera[focused]}
              large
              onClick={() => onFocusChange(null)}
            />
          </div>
          {others.length > 0 && (
            <div className="cameras-focus-strip">
              {others.map((id) => (
                <CameraTile
                  key={id}
                  entityId={id}
                  {...infoFor(id)}
                  motion={!!motionByCamera[id]}
                  onClick={() => onFocusChange(id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="cameras-view">
      <div className="cameras-grid" data-count={Math.min(cameraIds.length, 9)}>
        {cameraIds.map((id) => (
          <CameraTile
            key={id}
            entityId={id}
            {...infoFor(id)}
            motion={!!motionByCamera[id]}
            large={cameraIds.length === 1}
            onClick={() => onFocusChange(id)}
          />
        ))}
      </div>
    </div>
  );
}

interface CameraTileProps {
  entityId: string;
  name: string;
  available: boolean;
  accessToken?: string;
  motion: boolean;
  large?: boolean;
  onClick: () => void;
}

function CameraTile({ entityId, name, available, accessToken, motion, large = false, onClick }: CameraTileProps) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [mode, setMode] = useState<'hls' | 'snapshot'>('hls');
  const [playing, setPlaying] = useState(false);
  const [stamp, setStamp] = useState(() => Date.now());
  /** The snapshot request failed too: nothing to show for this camera right now. */
  const [snapshotBroken, setSnapshotBroken] = useState(false);

  // Live stream. A fatal HLS error, a stream that never starts, or a camera HA
  // cannot stream at all drops to snapshots.
  useEffect(() => {
    if (mode !== 'hls' || !available) return;
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    let hls: Hls | null = null;
    const fallback = () => {
      if (cancelled) return;
      setPlaying(false);
      setMode('snapshot');
    };
    const startTimer = setTimeout(fallback, HLS_START_TIMEOUT_MS);
    const onPlaying = () => clearTimeout(startTimer);
    video.addEventListener('playing', onPlaying);

    requestCameraStream(entityId).then((url) => {
      if (cancelled) return;
      if (Hls.isSupported()) {
        hls = new Hls({
          lowLatencyMode: true,
          liveSyncDurationCount: 2,
          liveMaxLatencyDurationCount: 6,
          maxBufferLength: 8,
          backBufferLength: 0,
        });
        let recoveredOnce = false;
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recoveredOnce) {
            recoveredOnce = true;
            hls?.recoverMediaError();
            return;
          }
          fallback();
        });
        hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => { /* autoplay blocked: poster stays */ }); });
        hls.loadSource(url);
        hls.attachMedia(video);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url;
        video.play().catch(() => { /* ignore */ });
      } else {
        fallback();
      }
    }).catch(fallback);

    return () => {
      cancelled = true;
      clearTimeout(startTimer);
      video.removeEventListener('playing', onPlaying);
      if (hls) hls.destroy();
      video.removeAttribute('src');
      video.load();
      setPlaying(false);
    };
  }, [entityId, mode, available]);

  // Snapshot fallback: refresh every 2 s and give the live stream another go after a minute.
  useEffect(() => {
    if (mode !== 'snapshot' || !available) return;
    const tick = setInterval(() => { if (!document.hidden) setStamp(Date.now()); }, SNAPSHOT_MS);
    const retry = setTimeout(() => setMode('hls'), HLS_RETRY_MS);
    return () => {
      clearInterval(tick);
      clearTimeout(retry);
    };
  }, [mode, available]);

  const classes = ['camera-tile'];
  if (large) classes.push('camera-tile--large'); else classes.push('camera-tile--small');
  if (motion) classes.push('camera-tile--motion');
  if (playing) classes.push('camera-tile--playing');

  return (
    <div className={classes.join(' ')} onClick={onClick} role="button" tabIndex={0} aria-label={name}>
      {available ? (
        <>
          {/* The snapshot shows at once (and keeps refreshing in snapshot mode); video fades in over it once it plays. */}
          <img
            src={cameraSnapshotUrl(entityId, large ? 1280 : 640, stamp, accessToken)}
            alt=""
            draggable={false}
            onLoad={() => setSnapshotBroken(false)}
            onError={() => setSnapshotBroken(true)}
          />
          {snapshotBroken && !playing && (
            <div className="camera-tile-unavailable">
              <Cctv size={large ? 48 : 28} strokeWidth={1.25} />
              <span>{t('cameras.noPicture')}</span>
            </div>
          )}
          {mode === 'hls' && (
            <video
              ref={videoRef}
              muted
              autoPlay
              playsInline
              onPlaying={() => setPlaying(true)}
              onWaiting={() => setPlaying(false)}
            />
          )}
        </>
      ) : (
        <div className="camera-tile-unavailable">
          <Cctv size={large ? 48 : 28} strokeWidth={1.25} />
          <span>{t('cameras.unavailable')}</span>
        </div>
      )}
      <div className="camera-tile-bar">
        <span className="camera-tile-name">{name}</span>
        {available && playing && <span className="camera-badge camera-badge--live"><span className="camera-badge-dot" />{t('cameras.live')}</span>}
        {available && !playing && mode === 'snapshot' && <span className="camera-badge">{t('cameras.snapshot')}</span>}
        {motion && <span className="camera-badge camera-badge--motion"><span className="camera-badge-dot" />{t('cameras.motion')}</span>}
      </div>
    </div>
  );
}

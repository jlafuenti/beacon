import { Music, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { DashboardCardProps } from '../../types/dashboard-cards';
import { albumArtUrl } from '../../utils/albumArt';
import { useTranslation } from '../../i18n';

/**
 * Dashboard "Now Playing" card: art, title, artist and big touch controls for
 * the active media player. Stays on the dashboard (unlike the bottom bar) so
 * pausing never depends on the voice assistant hearing "pause".
 */
export function NowPlayingCard({ context }: DashboardCardProps) {
  const { t } = useTranslation();
  const music = context.music;
  const player = music?.player ?? null;
  const active = !!player && (player.state === 'playing' || player.state === 'paused');

  if (!music || !active) {
    return (
      <section className="dash-sidebar-section now-playing-card now-playing-card--idle">
        <h3 className="dash-sidebar-heading">{t('music.nowPlaying')}</h3>
        <div className="now-playing-card-idle">
          <Music size={18} />
          <span>{t('cards.nowPlaying.nothingPlaying')}</span>
        </div>
      </section>
    );
  }

  const isPlaying = player.state === 'playing';
  const artSrc = albumArtUrl(player);

  return (
    <section className="dash-sidebar-section now-playing-card">
      <h3 className="dash-sidebar-heading">{t('music.nowPlaying')}</h3>
      <button
        type="button"
        className="now-playing-card-info"
        onClick={music.onOpen}
        aria-label={t('music.openMusicView')}
      >
        {artSrc ? (
          <img className="now-playing-card-art" src={artSrc} alt={player.media_album_name || t('music.albumArt')} />
        ) : (
          <div className="now-playing-card-art now-playing-card-art--placeholder"><Music size={28} /></div>
        )}
        <div className="now-playing-card-text">
          <span className="now-playing-card-title">
            {player.media_title || player.app_name || player.friendly_name}
          </span>
          <span className="now-playing-card-artist">{player.media_artist || ''}</span>
          <span className="now-playing-card-player">{player.friendly_name}</span>
        </div>
      </button>
      <div className="now-playing-card-controls">
        <button type="button" className="now-playing-card-btn" onClick={music.onPrevious} aria-label={t('music.previousTrack')}>
          <SkipBack size={22} />
        </button>
        <button
          type="button"
          className="now-playing-card-btn now-playing-card-btn--play"
          onClick={isPlaying ? music.onPause : music.onPlay}
          aria-label={isPlaying ? t('music.pause') : t('music.play')}
        >
          {isPlaying ? <Pause size={28} /> : <Play size={28} />}
        </button>
        <button type="button" className="now-playing-card-btn" onClick={music.onNext} aria-label={t('music.nextTrack')}>
          <SkipForward size={22} />
        </button>
      </div>
    </section>
  );
}

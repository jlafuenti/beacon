import { getConfig } from '../config';
import { MediaPlayer } from '../types/music';

/**
 * Album art URL for a media player.
 *
 * Prefers HA's own `entity_picture_local` proxy path: Music Assistant sets
 * `entity_picture` to an absolute http URL on its own host and port
 * (e.g. http://192.168.6.182:8095/imageproxy/...), which a panel on another
 * VLAN, or an https page, cannot load. The local path goes through HA and is
 * signed with the player's access token, so it needs no auth header.
 */
export function albumArtUrl(player: MediaPlayer | null | undefined): string | null {
  if (!player) return null;
  const haUrl = getConfig().ha_url.replace(/\/$/, '');
  const pic = player.entity_picture_local || player.entity_picture;
  if (!pic) return null;
  return pic.startsWith('http') ? pic : `${haUrl}${pic}`;
}

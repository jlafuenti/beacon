/**
 * Camera helpers for the Cameras tab (Lafuenti fork).
 *
 * Live video comes from HA's stream integration as HLS. HA only creates those
 * playlists through its WebSocket API (camera/stream), which the add-on server
 * bridges at /beacon-action/camera-stream; the playlist and its segments are
 * then plain /api/hls/... requests through the same proxy as every other HA
 * call. Snapshots (/api/camera_proxy) are the fallback when a stream fails.
 */
import { callBeaconAction, getHaBaseUrl } from './ha-rest';

/** Ask HA for an HLS playlist for the camera; resolves to a URL the browser can fetch. */
export async function requestCameraStream(entityId: string): Promise<string> {
  const res = await callBeaconAction('/beacon-action/camera-stream', { entity_id: entityId }) as { url?: string } | null;
  if (!res?.url) throw new Error('No stream URL returned');
  return `${getHaBaseUrl()}${res.url}`;
}

/**
 * Snapshot URL for a camera, scaled by HA to `width`. `stamp` busts the cache
 * on each refresh; `accessToken` (the camera's access_token attribute) lets the
 * image load without an Authorization header outside the add-on proxy.
 */
export function cameraSnapshotUrl(entityId: string, width: number, stamp: number, accessToken?: string): string {
  const params = new URLSearchParams({ width: String(width), t: String(stamp) });
  if (accessToken) params.set('token', accessToken);
  return `${getHaBaseUrl()}/api/camera_proxy/${entityId}?${params.toString()}`;
}

/** "Driveway High resolution channel" → "Driveway" (UniFi Protect names its channels). */
export function displayCameraName(friendlyName: string): string {
  return friendlyName
    .replace(/\s+(high|medium|low)\s+resolution\s+channel$/i, '')
    .replace(/\s+camera$/i, '')
    .trim() || friendlyName;
}

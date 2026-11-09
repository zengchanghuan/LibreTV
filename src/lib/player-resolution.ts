export type VideoResolution = { label: string; badge: 'HD' | 'FHD' | 'QHD' | '4K' | '8K' | null; detail: string };

// Explicit 16:9 display tiers; these are not thresholds for arbitrary crops.
// https://support.google.com/youtube/answer/6375112
// FHD/QHD nomenclature: https://www.samsung.com/uk/monitors/monitor-buying-guide/how-to-select-by-resolution/
const RESOLUTION_TIERS: Readonly<Record<string, Pick<VideoResolution, 'label' | 'badge'>>> = {
  '7680x4320': { label: '4320p', badge: '8K' },
  '3840x2160': { label: '2160p', badge: '4K' },
  '2560x1440': { label: '1440p', badge: 'QHD' },
  '1920x1080': { label: '1080p', badge: 'FHD' },
  '1280x720': { label: '720p', badge: 'HD' },
  '854x480': { label: '480p', badge: null },
  '640x360': { label: '360p', badge: null },
  '426x240': { label: '240p', badge: null },
};

/** Use decoded video dimensions, never the source's advertised quality. */
export function readVideoResolution(video: HTMLVideoElement): VideoResolution | null {
  const { videoWidth: width, videoHeight: height } = video;
  if (!video.getAttribute('src') || video.readyState < 1 || !width || !height) return null;
  const detail = `${width} × ${height}`;
  // Apply the same display tier to the rotated portrait raster. Preserve the
  // actual dimensions for crops, ultrawide video, and other unlisted formats.
  const tier = RESOLUTION_TIERS[`${Math.max(width, height)}x${Math.min(width, height)}`];
  return { ...(tier ?? { label: detail, badge: null }), detail };
}

export function observeVideoResolution(video: HTMLVideoElement, update: (value: VideoResolution | null) => void) {
  const refresh = () => update(readVideoResolution(video));
  const reset = () => update(null);
  const refreshEvents = ['loadedmetadata', 'loadeddata', 'resize'];
  const resetEvents = ['emptied', 'loadstart', 'error'];
  refreshEvents.forEach(event => video.addEventListener(event, refresh));
  resetEvents.forEach(event => video.addEventListener(event, reset));
  refresh();
  return () => {
    refreshEvents.forEach(event => video.removeEventListener(event, refresh));
    resetEvents.forEach(event => video.removeEventListener(event, reset));
  };
}

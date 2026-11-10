export type VideoResolution = { label: string; badge: 'HD' | 'FHD' | 'QHD' | '4K' | '8K' | null; detail: string };

// Standard 16:9 reference rasters. The UI also uses their nominal display tier
// for wider crops with the same long edge; that is a display convention, not
// a claim that the decoded video contains the reference raster's full height.
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
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  const exact = RESOLUTION_TIERS[`${longEdge}x${shortEdge}`];
  // For example, a 1920 × 800 widescreen movie belongs to the 1080p display
  // tier. Do not round unrelated sizes (such as 1600 × 900) up to that tier.
  const crop = Object.entries(RESOLUTION_TIERS).find(([raster]) => {
    const [referenceWidth, referenceHeight] = raster.split('x').map(Number);
    return longEdge === referenceWidth && shortEdge < referenceHeight;
  })?.[1];
  return { ...(exact ?? crop ?? { label: `${shortEdge}p`, badge: null }), detail };
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

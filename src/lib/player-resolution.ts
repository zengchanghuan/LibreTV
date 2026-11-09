export type VideoResolution = { label: string; badge: 'HD' | '4K' | '8K' | null; detail: string };

/** Use decoded video dimensions, never the source's advertised quality. */
export function readVideoResolution(video: HTMLVideoElement): VideoResolution | null {
  const { videoWidth: width, videoHeight: height } = video;
  if (!video.getAttribute('src') || video.readyState < 1 || !width || !height) return null;
  const detail = `${width} × ${height}`;
  // The short edge keeps portrait video in the same tier as landscape video.
  const pixels = Math.min(width, height);
  const longEdge = Math.max(width, height);
  const label = `${pixels}p`;
  const badge = pixels >= 4320 && longEdge >= 7680 ? '8K'
    : pixels >= 2160 && longEdge >= 3840 ? '4K'
    : pixels >= 1080 ? 'HD' : null;
  return { label, badge, detail };
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

export type VideoResolution = { label: string; detail: string };

/** Use decoded video dimensions, never the source's advertised quality. */
export function readVideoResolution(video: HTMLVideoElement): VideoResolution | null {
  const { videoWidth: width, videoHeight: height } = video;
  if (!video.getAttribute('src') || video.readyState < 1 || !width || !height) return null;
  const detail = `${width} × ${height}`;
  const standardHeight = [240, 360, 480, 576, 720, 1080, 1440, 2160, 4320].includes(height);
  const label = width >= height && standardHeight
    ? (height === 2160 && width >= 3840 ? '4K' : height === 4320 && width >= 7680 ? '8K' : `${height}P`)
    : detail;
  return { label, detail };
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

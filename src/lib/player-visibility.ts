/** Keep background tabs playing; stop media when the document is actually left. */
export function bindPlaybackVisibility(video: HTMLVideoElement): () => void {
  let pageLeft = false;
  const pauseIfPageLeft = () => {
    if (pageLeft) video.pause();
  };
  const pageHide = () => {
    pageLeft = true;
    video.pause();
  };
  const pageShow = () => {
    pageLeft = false;
    // Restoring a document must not resume a manual pause or a sleep timer.
  };
  // visibilitychange also fires when opening another tab. It must not pause
  // playback or reject buffering recovery in a still-open background tab.
  window.addEventListener('pagehide', pageHide);
  window.addEventListener('pageshow', pageShow);
  // Suppress late autoplay/recovery after navigation or entering the back cache.
  video.addEventListener('play', pauseIfPageLeft);
  video.addEventListener('playing', pauseIfPageLeft);
  return () => {
    window.removeEventListener('pagehide', pageHide);
    window.removeEventListener('pageshow', pageShow);
    video.removeEventListener('play', pauseIfPageLeft);
    video.removeEventListener('playing', pauseIfPageLeft);
  };
}

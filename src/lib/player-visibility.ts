/** Pause on screen lock/backgrounding, including delayed autoplay and recovery. */
export function bindPlaybackVisibility(video: HTMLVideoElement): () => void {
  let pageHidden = false;
  const pauseIfHidden = () => {
    if (pageHidden || document.hidden) video.pause();
  };
  const pageHide = () => {
    pageHidden = true;
    video.pause();
  };
  const pageShow = () => {
    pageHidden = false;
    pauseIfHidden();
    // Returning to the page must not automatically resume playback.
  };
  document.addEventListener('visibilitychange', pauseIfHidden);
  window.addEventListener('pagehide', pageHide);
  window.addEventListener('pageshow', pageShow);
  // Media loading/recovery can call play after the page has already been hidden.
  video.addEventListener('play', pauseIfHidden);
  video.addEventListener('playing', pauseIfHidden);
  pauseIfHidden();
  return () => {
    document.removeEventListener('visibilitychange', pauseIfHidden);
    window.removeEventListener('pagehide', pageHide);
    window.removeEventListener('pageshow', pageShow);
    video.removeEventListener('play', pauseIfHidden);
    video.removeEventListener('playing', pauseIfHidden);
  };
}

import type Artplayer from 'artplayer';

/** Measure the stationary player container, never the video moved into the popup. */
export function bindAutoMini(art: Artplayer): () => void {
  let frame: number | undefined;
  const update = () => {
    frame = undefined;
    // Scrolling/resizing must not exit a fullscreen or native picture-in-picture session.
    if (art.fullscreen || art.fullscreenWeb || art.pip) return;
    const rect = art.template.$container.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const visible = rect.bottom > 0 && rect.top < window.innerHeight
      && rect.right > 0 && rect.left < window.innerWidth;
    if (art.mini === visible) art.mini = !visible;
  };
  const schedule = () => {
    // Unlike a leading-only throttle, this reads the final position even if the
    // last scroll event arrives immediately after the previous measurement.
    if (frame === undefined) frame = requestAnimationFrame(update);
  };
  window.addEventListener('scroll', schedule, { capture: true, passive: true });
  window.addEventListener('resize', schedule);
  art.on('fullscreen', schedule);
  art.on('fullscreenWeb', schedule);
  art.on('pip', schedule);
  const observer = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver(schedule);
  observer?.observe(art.template.$container);
  schedule();
  return () => {
    window.removeEventListener('scroll', schedule, true);
    window.removeEventListener('resize', schedule);
    art.off('fullscreen', schedule);
    art.off('fullscreenWeb', schedule);
    art.off('pip', schedule);
    observer?.disconnect();
    if (frame !== undefined) cancelAnimationFrame(frame);
  };
}

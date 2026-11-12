import type Artplayer from 'artplayer';
import { formatTime } from './utils';

/** Keep the timeline on the media clock, except while previewing an active seek. */
export function bindProgressSeek(art: Artplayer, preview: (time: number | null) => void): () => void {
  const bar = art.template.$progress;
  const doc = bar.ownerDocument;
  let pointer: number | undefined;
  let target = 0;
  let pending: number | undefined;
  let bounds: { left: number; width: number };
  let frame: number | undefined;
  let suppressClick = false;
  const oldTouchAction = bar.style.touchAction;
  bar.style.touchAction = 'none';

  const display = (time: number | null) => {
    const value = time ?? art.currentTime;
    art.emit('setBar', 'played', art.duration > 0 ? value / art.duration : 0);
    // ArtPlayer normally updates this label on timeupdate/progress, which can
    // arrive much later than seeking when a remote MP4 is still buffering.
    const label = art.template.$player.querySelector('.art-control-time');
    if (label) label.textContent = `${formatTime(value)} / ${formatTime(art.duration)}`;
    preview(time);
  };

  const render = () => {
    // A seeked event can be missed or superseded. Once the media is no longer
    // seeking, a remembered target must not overwrite ongoing playback updates.
    if (pending !== undefined && !art.video.seeking) pending = undefined;
    const time = pointer !== undefined ? target : pending;
    // The persistent time label previews the target. Hide ArtPlayer's stale
    // mouse-hover tooltip while its continuous-seek handlers are suspended.
    if (time !== undefined) art.template.$player.classList.remove('art-progress-hover');
    display(time ?? null);
  };
  const schedule = () => {
    if (pointer !== undefined && frame === undefined) frame = requestAnimationFrame(() => { frame = undefined; render(); });
  };
  const position = (event: PointerEvent) => {
    // Revealing the full controls changes the mini bar's width. A single
    // gesture must retain the geometry on which the user pressed.
    const rect = bounds;
    if (rect.width > 0) target = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * art.duration;
  };
  const stop = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const down = (event: PointerEvent) => {
    if (!event.isPrimary || event.button !== 0 || pointer !== undefined || !Number.isFinite(art.duration) || art.duration <= 0) return;
    stop(event);
    pointer = event.pointerId;
    bounds = bar.getBoundingClientRect();
    suppressClick = true;
    position(event);
    bar.setPointerCapture(event.pointerId);
    art.controls.show = true;
    schedule();
  };
  const move = (event: PointerEvent) => {
    if (event.pointerId !== pointer) return;
    stop(event);
    position(event);
    schedule();
  };
  const finish = (commit: boolean) => {
    if (pointer === undefined) return;
    const id = pointer;
    pointer = undefined;
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    if (bar.hasPointerCapture(id)) bar.releasePointerCapture(id);
    if (commit) {
      pending = target;
      art.seek = target;
      art.notice.show = `${formatTime(target)} / ${formatTime(art.duration)}`;
    }
    display(pending ?? null);
  };
  const up = (event: PointerEvent) => {
    if (event.pointerId !== pointer) return;
    stop(event);
    position(event);
    finish(true);
  };
  const cancel = () => finish(false);
  const settled = () => {
    pending = undefined;
    if (pointer === undefined) display(null);
  };
  const reset = () => { pending = undefined; cancel(); display(null); };
  const otherSeek = (_current: number, requested: number) => {
    if (pending !== undefined && requested !== pending) settled();
  };
  const cancelPointer = (event: PointerEvent) => {
    if (event.pointerId === pointer) cancel();
  };
  // ArtPlayer also listens to compatibility mouse/touch events. Do not let
  // those handlers perform their own continuous seeks or duplicate the click.
  const legacyStart = (event: Event) => { if (pointer !== undefined) stop(event); };
  const click = (event: MouseEvent) => {
    if (suppressClick && event.detail !== 0) { suppressClick = false; stop(event); }
  };
  const keepControls = (visible: boolean) => {
    if (!visible && pointer !== undefined) art.controls.show = true;
  };
  const clockEvents = ['video:timeupdate', 'video:progress', 'video:playing', 'video:pause', 'video:loadedmetadata', 'video:durationchange'] as const;
  bar.addEventListener('pointerdown', down, true);
  bar.addEventListener('mousedown', legacyStart, true);
  bar.addEventListener('touchstart', legacyStart, { capture: true, passive: false });
  bar.addEventListener('click', click, true);
  doc.addEventListener('pointermove', move, true);
  doc.addEventListener('pointerup', up, true);
  doc.addEventListener('pointercancel', cancelPointer, true);
  // Capture can be lost just before a physical mouse release. Keep the gesture
  // until document's pointerup; only pointercancel/blur mean it was abandoned.
  doc.defaultView?.addEventListener('blur', cancel);
  for (const event of clockEvents) art.on(event, render);
  art.on('video:seeked', settled);
  art.on('video:emptied', reset);
  art.on('video:error', reset);
  art.on('seek', otherSeek);
  art.on('control', keepControls);
  return () => {
    reset();
    if (frame !== undefined) cancelAnimationFrame(frame);
    bar.style.touchAction = oldTouchAction;
    bar.removeEventListener('pointerdown', down, true);
    bar.removeEventListener('mousedown', legacyStart, true);
    bar.removeEventListener('touchstart', legacyStart, true);
    bar.removeEventListener('click', click, true);
    doc.removeEventListener('pointermove', move, true);
    doc.removeEventListener('pointerup', up, true);
    doc.removeEventListener('pointercancel', cancelPointer, true);
    doc.defaultView?.removeEventListener('blur', cancel);
    for (const event of clockEvents) art.off(event, render);
    art.off('video:seeked', settled);
    art.off('video:emptied', reset);
    art.off('video:error', reset);
    art.off('seek', otherSeek);
    art.off('control', keepControls);
  };
}

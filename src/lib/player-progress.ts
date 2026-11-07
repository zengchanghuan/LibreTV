import type Artplayer from 'artplayer';

/** Preview a drag locally; only the final position should start a media request. */
export function bindProgressSeek(art: Artplayer, preview: (time: number | null) => void): () => void {
  const bar = art.template.$progress;
  const doc = bar.ownerDocument;
  let pointer: number | undefined;
  let target = 0;
  let frame: number | undefined;
  let suppressClick = false;
  const oldTouchAction = bar.style.touchAction;
  bar.style.touchAction = 'none';

  const render = () => {
    frame = undefined;
    if (pointer === undefined) return;
    // The persistent time label previews the target. Hide ArtPlayer's stale
    // mouse-hover tooltip while its continuous-seek handlers are suspended.
    art.template.$player.classList.remove('art-progress-hover');
    art.emit('setBar', 'played', target / art.duration);
    preview(target);
  };
  const schedule = () => {
    if (pointer !== undefined && frame === undefined) frame = requestAnimationFrame(render);
  };
  const position = (event: PointerEvent) => {
    const rect = bar.getBoundingClientRect();
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
    if (commit) art.seek = target;
    art.emit('setBar', 'played', art.duration > 0 ? art.currentTime / art.duration : 0);
    preview(null);
  };
  const up = (event: PointerEvent) => {
    if (event.pointerId !== pointer) return;
    stop(event);
    position(event);
    finish(true);
  };
  const cancel = () => finish(false);
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
  bar.addEventListener('pointerdown', down, true);
  bar.addEventListener('mousedown', legacyStart, true);
  bar.addEventListener('touchstart', legacyStart, { capture: true, passive: false });
  bar.addEventListener('click', click, true);
  doc.addEventListener('pointermove', move, true);
  doc.addEventListener('pointerup', up, true);
  doc.addEventListener('pointercancel', cancelPointer, true);
  bar.addEventListener('lostpointercapture', cancelPointer);
  doc.defaultView?.addEventListener('blur', cancel);
  art.on('video:timeupdate', schedule);
  art.on('video:emptied', cancel);
  art.on('control', keepControls);
  return () => {
    cancel();
    if (frame !== undefined) cancelAnimationFrame(frame);
    bar.style.touchAction = oldTouchAction;
    bar.removeEventListener('pointerdown', down, true);
    bar.removeEventListener('mousedown', legacyStart, true);
    bar.removeEventListener('touchstart', legacyStart, true);
    bar.removeEventListener('click', click, true);
    doc.removeEventListener('pointermove', move, true);
    doc.removeEventListener('pointerup', up, true);
    doc.removeEventListener('pointercancel', cancelPointer, true);
    bar.removeEventListener('lostpointercapture', cancelPointer);
    doc.defaultView?.removeEventListener('blur', cancel);
    art.off('video:timeupdate', schedule);
    art.off('video:emptied', cancel);
    art.off('control', keepControls);
  };
}

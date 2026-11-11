import type Artplayer from 'artplayer';

const IDLE_MS = 3000;
const INTERACTIVE = '.art-controls, .art-progress, .art-settings, .playback-tools-panel';

/** One visibility policy for mouse entry, fullscreen idle and active controls. */
export function bindPlaybackControls(art: Artplayer): () => void {
  const root = art.template.$player;
  const doc = root.ownerDocument;
  const releaseTarget = doc.defaultView ?? doc;
  let inside = false;
  let overControl = false;
  let pointerPosition: { x: number; y: number } | undefined;
  let dragging: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let panelOpen = !!root.querySelector('.playback-tools-panel');
  const interactive = (target: EventTarget | null) => target instanceof Element
    && root.contains(target) && !!target.closest(INTERACTIVE);
  const rememberPosition = (event: PointerEvent) => {
    if (event.pointerType !== 'touch') pointerPosition = { x: event.clientX, y: event.clientY };
  };
  const refreshHover = () => {
    if (!pointerPosition) return;
    const target = doc.elementFromPoint(pointerPosition.x, pointerPosition.y);
    inside = !!target && root.contains(target);
    overControl = interactive(target);
  };
  const pinned = () => art.video.paused || art.video.seeking || dragging !== undefined
    || (inside && ((!art.fullscreen && !art.fullscreenWeb) || overControl))
    || art.setting.show || panelOpen
    || (interactive(doc.activeElement) && doc.activeElement!.matches(':focus-visible'));
  const clear = () => { clearTimeout(timer); timer = undefined; };
  const schedule = () => {
    clear();
    if (disposed || !art.controls.show || pinned()) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (!disposed && !pinned()) art.controls.show = false;
    }, IDLE_MS);
  };
  const reveal = () => {
    if (disposed) return;
    // Set even when already visible: ArtPlayer also resets its own idle timer.
    art.controls.show = true;
  };
  const control = (visible: boolean) => {
    if (!visible && pinned()) reveal();
    else if (visible) schedule();
    else clear();
  };
  const enter = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return;
    rememberPosition(event);
    inside = true; overControl = interactive(event.target); reveal();
  };
  const move = enter;
  const leave = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return;
    inside = false; overControl = false;
    if (art.fullscreen || art.fullscreenWeb) schedule();
    else if (!pinned()) art.controls.show = false;
  };
  const down = (event: PointerEvent) => {
    if (event.button !== 0 || !interactive(event.target)) return;
    rememberPosition(event);
    dragging = event.pointerId; reveal();
  };
  const up = (event: PointerEvent) => {
    if (dragging !== event.pointerId) return;
    dragging = undefined;
    if (event.type === 'pointercancel') { inside = false; overControl = false; }
    else if (event.pointerType !== 'touch') {
      // Pointer capture reports the bar as target even when released elsewhere.
      rememberPosition(event); refreshHover();
    }
    reveal();
  };
  const blur = () => {
    pointerPosition = undefined;
    inside = false; overControl = false; dragging = undefined;
    if (!pinned()) art.controls.show = false;
  };
  const focus = () => queueMicrotask(() => { if (!disposed) reveal(); });
  // ArtPlayer emits native fullscreen before updating its layout classes.
  // Recheck the stationary pointer after those synchronous updates finish.
  const modeChanged = () => queueMicrotask(() => {
    if (disposed) return;
    refreshHover(); reveal();
  });
  const panelChanged = () => {
    const next = !!root.querySelector('.playback-tools-panel');
    if (next !== panelOpen) { panelOpen = next; reveal(); }
  };
  const observer = new MutationObserver(panelChanged);
  observer.observe(root, { childList: true, subtree: true });
  root.addEventListener('pointerenter', enter);
  root.addEventListener('pointermove', move);
  root.addEventListener('pointerleave', leave);
  // Capture before the progress drag handler stops propagation.
  root.addEventListener('pointerdown', down, true);
  // Window capture runs before progress seeking stops events at document.
  releaseTarget.addEventListener('pointerup', up as EventListener, true);
  releaseTarget.addEventListener('pointercancel', up as EventListener, true);
  root.addEventListener('focusin', focus);
  root.addEventListener('focusout', focus);
  doc.defaultView?.addEventListener('blur', blur);
  art.on('control', control);
  art.on('video:seeking', reveal);
  art.on('video:seeked', reveal);
  art.on('video:play', schedule);
  art.on('fullscreen', modeChanged);
  art.on('fullscreenWeb', modeChanged);
  art.on('setting', reveal);
  schedule();
  return () => {
    disposed = true; clear(); observer.disconnect();
    root.removeEventListener('pointerenter', enter);
    root.removeEventListener('pointermove', move);
    root.removeEventListener('pointerleave', leave);
    root.removeEventListener('pointerdown', down, true);
    releaseTarget.removeEventListener('pointerup', up as EventListener, true);
    releaseTarget.removeEventListener('pointercancel', up as EventListener, true);
    root.removeEventListener('focusin', focus);
    root.removeEventListener('focusout', focus);
    doc.defaultView?.removeEventListener('blur', blur);
    art.off('control', control);
    art.off('video:seeking', reveal);
    art.off('video:seeked', reveal);
    art.off('video:play', schedule);
    art.off('fullscreen', modeChanged);
    art.off('fullscreenWeb', modeChanged);
    art.off('setting', reveal);
  };
}

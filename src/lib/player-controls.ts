import type Artplayer from 'artplayer';
import { isPlaybackFullscreen } from './player-fullscreen';

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
  let modeUpdateQueued = false;
  let fullscreen = isPlaybackFullscreen(art);
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
    || (inside && (!isPlaybackFullscreen(art) || overControl))
    || art.setting.show || panelOpen
    || (interactive(doc.activeElement) && doc.activeElement!.matches(':focus-visible'));
  const clear = () => { clearTimeout(timer); timer = undefined; };
  const render = () => {
    const activeFullscreen = isPlaybackFullscreen(art);
    // One state owns both the progress bar and buttons. Do not let ArtPlayer's
    // hover / mini-progress classes independently move the buttons offscreen.
    root.dataset.hometvFullscreen = String(activeFullscreen);
    root.dataset.hometvControls = art.controls.show ? 'visible' : activeFullscreen ? 'hidden' : 'mini';
  };
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
  const control = () => {
    // An earlier listener (e.g. progress dragging) may synchronously re-show
    // controls while handling the same hide event. Read the final state.
    if (!art.controls.show && pinned()) { reveal(); return; }
    render();
    if (art.controls.show) schedule();
    else clear();
  };
  const enter = (event: MouseEvent | PointerEvent) => {
    if ('pointerType' in event && event.pointerType === 'touch') return;
    pointerPosition = { x: event.clientX, y: event.clientY };
    inside = true; overControl = interactive(event.target); reveal();
  };
  const move = enter;
  const leave = (event: MouseEvent | PointerEvent) => {
    if ('pointerType' in event && event.pointerType === 'touch') return;
    inside = false; overControl = false;
    if (isPlaybackFullscreen(art)) schedule();
    else if (!pinned()) art.controls.show = false;
  };
  const mouse = (event: MouseEvent) => {
    // Touch browsers synthesize mouse events after a tap. Those must not pin
    // the inline controls as though a desktop cursor were parked on the video.
    if (!doc.defaultView?.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    if (event.type === 'mouseleave') leave(event);
    else enter(event);
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
  // Browser and ArtPlayer events may arrive in either order. Coalesce them,
  // then read the actual fullscreen element and the latest pointer hit target.
  const modeChanged = () => {
    if (modeUpdateQueued) return;
    modeUpdateQueued = true;
    queueMicrotask(() => {
      modeUpdateQueued = false;
      if (disposed) return;
      const next = isPlaybackFullscreen(art);
      const changed = next !== fullscreen;
      fullscreen = next;
      refreshHover();
      if (changed) reveal();
      else control();
    });
  };
  const panelChanged = () => {
    const next = !!root.querySelector('.playback-tools-panel');
    if (next !== panelOpen) { panelOpen = next; reveal(); }
  };
  const observer = new MutationObserver(panelChanged);
  observer.observe(root, { childList: true, subtree: true });
  root.addEventListener('pointerenter', enter);
  root.addEventListener('pointermove', move);
  root.addEventListener('pointerleave', leave);
  // Also accept desktop mouse events after a Safari fullscreen transition.
  // Pointer events remain responsible for touch and drag ownership.
  root.addEventListener('mouseenter', mouse);
  root.addEventListener('mousemove', mouse);
  root.addEventListener('mouseleave', mouse);
  // Capture before the progress drag handler stops propagation.
  root.addEventListener('pointerdown', down, true);
  // Window capture runs before progress seeking stops events at document.
  releaseTarget.addEventListener('pointerup', up as EventListener, true);
  releaseTarget.addEventListener('pointercancel', up as EventListener, true);
  root.addEventListener('focusin', focus);
  root.addEventListener('focusout', focus);
  doc.defaultView?.addEventListener('blur', blur);
  doc.defaultView?.addEventListener('resize', modeChanged);
  doc.addEventListener('fullscreenchange', modeChanged);
  doc.addEventListener('webkitfullscreenchange', modeChanged);
  art.video.addEventListener('webkitbeginfullscreen', modeChanged);
  art.video.addEventListener('webkitendfullscreen', modeChanged);
  art.on('control', control);
  art.on('video:seeking', reveal);
  art.on('video:seeked', reveal);
  art.on('video:play', schedule);
  art.on('fullscreen', modeChanged);
  art.on('fullscreenWeb', modeChanged);
  art.on('setting', reveal);
  control();
  return () => {
    disposed = true; clear(); observer.disconnect();
    root.removeEventListener('pointerenter', enter);
    root.removeEventListener('pointermove', move);
    root.removeEventListener('pointerleave', leave);
    root.removeEventListener('mouseenter', mouse);
    root.removeEventListener('mousemove', mouse);
    root.removeEventListener('mouseleave', mouse);
    root.removeEventListener('pointerdown', down, true);
    releaseTarget.removeEventListener('pointerup', up as EventListener, true);
    releaseTarget.removeEventListener('pointercancel', up as EventListener, true);
    root.removeEventListener('focusin', focus);
    root.removeEventListener('focusout', focus);
    doc.defaultView?.removeEventListener('blur', blur);
    doc.defaultView?.removeEventListener('resize', modeChanged);
    doc.removeEventListener('fullscreenchange', modeChanged);
    doc.removeEventListener('webkitfullscreenchange', modeChanged);
    art.video.removeEventListener('webkitbeginfullscreen', modeChanged);
    art.video.removeEventListener('webkitendfullscreen', modeChanged);
    art.off('control', control);
    art.off('video:seeking', reveal);
    art.off('video:seeked', reveal);
    art.off('video:play', schedule);
    art.off('fullscreen', modeChanged);
    art.off('fullscreenWeb', modeChanged);
    art.off('setting', reveal);
    delete root.dataset.hometvControls;
    delete root.dataset.hometvFullscreen;
  };
}

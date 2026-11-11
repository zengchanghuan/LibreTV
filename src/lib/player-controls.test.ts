import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Artplayer from 'artplayer';
import { bindPlaybackControls } from './player-controls';

class TestElement extends EventTarget {
  parent: TestElement | null = null;
  isControl = false;
  focusVisible = false;
  contains(target: TestElement): boolean { return target === this || !!target.parent && this.contains(target.parent); }
  closest(): TestElement | null { return this.isControl ? this : this.parent?.closest() ?? null; }
  matches() { return this.focusVisible; }
}

const cleanups: Array<() => void> = [];
function player() {
  const win = new EventTarget();
  let hit: TestElement | null = null;
  const doc = Object.assign(new EventTarget(), {
    defaultView: win, activeElement: null as TestElement | null, elementFromPoint: () => hit,
  });
  let panel: TestElement | null = null;
  const root = Object.assign(new TestElement(), { ownerDocument: doc, querySelector: () => panel });
  const button = Object.assign(new TestElement(), { parent: root, isControl: true });
  let notifyMutation: () => void = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal('MutationObserver', class {
    constructor(callback: () => void) { notifyMutation = callback; }
    observe() {}
    disconnect = disconnect;
  });
  const listeners = new Map<string, Set<(visible: boolean) => void>>();
  let visible = false;
  const emit = (event: string, value = false) => [...listeners.get(event) ?? []].forEach(fn => fn(value));
  const art = {
    template: { $player: root },
    video: { paused: false, seeking: false, readyState: 4 },
    fullscreen: false,
    fullscreenWeb: false,
    setting: { show: false },
    controls: {
      get show() { return visible; },
      set show(value: boolean) { visible = value; emit('control', value); },
    },
    on(event: string, fn: (visible: boolean) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
    },
    off(event: string, fn: (visible: boolean) => void) { listeners.get(event)?.delete(fn); },
  };
  const dispose = bindPlaybackControls(art as unknown as Artplayer);
  cleanups.push(dispose);
  const pointer = (type: string, target = root as TestElement, pointerType = 'mouse', pointerId = 1) => {
    const event = Object.assign(new Event(type), { pointerType, pointerId, button: 0, clientX: 100, clientY: 100 });
    if (['pointerenter', 'pointermove', 'pointerdown'].includes(type)) hit = target;
    if (type === 'pointerleave') hit = null;
    Object.defineProperty(event, 'target', { value: target });
    // Capture order: window precedes document, even if document stops the event.
    if (type === 'pointerup' || type === 'pointercancel') {
      win.dispatchEvent(event);
      doc.dispatchEvent(event);
    } else root.dispatchEvent(event);
  };
  return { art, emit, dispose, root, button, doc, win, pointer, disconnect,
    setHit(target: TestElement | null) { hit = target; },
    setPanel(open: boolean) { panel = open ? button : null; notifyMutation(); },
    mutate: () => notifyMutation(),
  };
}

beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('Element', TestElement); });
afterEach(() => {
  cleanups.splice(0).forEach(fn => fn());
  vi.useRealTimers(); vi.unstubAllGlobals();
});

describe('playback control visibility', () => {
  it('shows on entry without movement and stays visible in window playback', () => {
    const { art, pointer } = player();
    pointer('pointerenter');
    expect(art.controls.show).toBe(true);
    vi.advanceTimersByTime(31_000);
    // ArtPlayer may try to hide on timeupdate; pointer presence takes priority.
    art.controls.show = false;
    expect(art.controls.show).toBe(true);
    pointer('pointerleave');
    expect(art.controls.show).toBe(false);
  });

  it.each(['fullscreen', 'fullscreenWeb'] as const)('hides after 3 seconds of inactivity in %s', mode => {
    const { art, pointer } = player();
    art[mode] = true;
    pointer('pointerenter');
    vi.advanceTimersByTime(2500);
    pointer('pointermove');
    vi.advanceTimersByTime(2999);
    expect(art.controls.show).toBe(true);
    vi.advanceTimersByTime(1);
    expect(art.controls.show).toBe(false);
    pointer('pointerenter');
    expect(art.controls.show).toBe(true);
  });

  it('keeps fullscreen controls visible under the pointer, then starts a fresh idle period', () => {
    const { art, pointer, button } = player();
    art.fullscreenWeb = true;
    pointer('pointermove', button);
    vi.advanceTimersByTime(10_000);
    art.controls.show = false;
    expect(art.controls.show).toBe(true);
    pointer('pointermove');
    vi.advanceTimersByTime(2999);
    expect(art.controls.show).toBe(true);
    vi.advanceTimersByTime(1);
    expect(art.controls.show).toBe(false);
  });

  it('holds controls during a drag and sees release before document handlers swallow it', () => {
    const { art, pointer, button, doc } = player();
    art.fullscreen = true;
    doc.addEventListener('pointerup', event => event.stopImmediatePropagation(), true);
    pointer('pointerdown', button);
    pointer('pointerleave');
    vi.advanceTimersByTime(10_000);
    expect(art.controls.show).toBe(true);
    pointer('pointerup', button, 'mouse', 2);
    vi.advanceTimersByTime(4000);
    expect(art.controls.show).toBe(true);
    pointer('pointerup', button);
    vi.advanceTimersByTime(2999);
    expect(art.controls.show).toBe(true);
    vi.advanceTimersByTime(1);
    expect(art.controls.show).toBe(false);
  });

  it.each(['pointercancel', 'blur'])('releases an interrupted drag on %s', type => {
    const { art, pointer, button, win } = player();
    art.fullscreen = true;
    pointer('pointerdown', button);
    if (type === 'blur') win.dispatchEvent(new Event('blur'));
    else pointer(type, button);
    vi.advanceTimersByTime(3000);
    expect(art.controls.show).toBe(false);
  });

  it('clears control hover after a captured drag is released over the picture', () => {
    const { art, pointer, button, root, setHit } = player();
    art.fullscreen = true;
    pointer('pointermove', button);
    pointer('pointerdown', button);
    // Seeking swallows moves at document, and capture keeps pointerup.target on the bar.
    setHit(root);
    pointer('pointerup', button);
    vi.advanceTimersByTime(3000);
    expect(art.controls.show).toBe(false);
  });

  it('rechecks hover after fullscreen layout changes move the button away', async () => {
    const { art, emit, pointer, button, root, setHit } = player();
    pointer('pointermove', button);
    art.fullscreen = true; emit('fullscreen', true);
    // ArtPlayer applies the native fullscreen classes after emitting its event.
    setHit(root);
    await Promise.resolve();
    vi.advanceTimersByTime(3000);
    expect(art.controls.show).toBe(false);
  });

  it('pins built-in settings and custom panels until closed', () => {
    const { art, emit, setPanel } = player();
    art.fullscreenWeb = true;
    art.setting.show = true;
    emit('setting', true);
    vi.advanceTimersByTime(5000);
    art.controls.show = false;
    expect(art.controls.show).toBe(true);
    art.setting.show = false;
    emit('setting', false);
    vi.advanceTimersByTime(3000);
    expect(art.controls.show).toBe(false);
    setPanel(true);
    vi.advanceTimersByTime(5000);
    expect(art.controls.show).toBe(true);
    setPanel(false);
    vi.advanceTimersByTime(2999);
    expect(art.controls.show).toBe(true);
    vi.advanceTimersByTime(1);
    expect(art.controls.show).toBe(false);
  });

  it('does not flash hidden controls on recurring network events or time-label mutations', () => {
    const { art, emit, mutate } = player();
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(30_000);
      emit('video:stalled'); art.video.readyState = 2; emit('video:waiting');
      art.controls.show = false;
      expect(art.controls.show).toBe(false);
      art.video.readyState = 4; emit('video:playing'); mutate();
      expect(art.controls.show).toBe(false);
    }
  });

  it('keeps paused and seeking playback operable, then hides after resuming', () => {
    const { art, emit } = player();
    art.video.paused = true;
    art.controls.show = false;
    expect(art.controls.show).toBe(true);
    art.video.paused = false;
    emit('video:play');
    vi.advanceTimersByTime(3000);
    expect(art.controls.show).toBe(false);
    art.video.seeking = true;
    emit('video:seeking');
    vi.advanceTimersByTime(5000);
    art.controls.show = false;
    expect(art.controls.show).toBe(true);
    art.video.seeking = false;
    emit('video:seeked');
    vi.advanceTimersByTime(3000);
    expect(art.controls.show).toBe(false);
  });

  it('applies fullscreen idle rules when switching modes without moving the pointer', async () => {
    const { art, emit, pointer } = player();
    pointer('pointerenter');
    art.fullscreenWeb = true; emit('fullscreenWeb', true);
    await Promise.resolve();
    vi.advanceTimersByTime(3000);
    expect(art.controls.show).toBe(false);
    art.fullscreenWeb = false; emit('fullscreenWeb', false);
    await Promise.resolve();
    vi.advanceTimersByTime(10_000);
    expect(art.controls.show).toBe(true);
  });

  it('does not treat touch entry as a mouse parked inside the window', () => {
    const { art, pointer } = player();
    pointer('pointerenter', undefined, 'touch');
    pointer('pointermove', undefined, 'touch');
    expect(art.controls.show).toBe(false);
    art.controls.show = true;
    vi.advanceTimersByTime(3000);
    expect(art.controls.show).toBe(false);
    art.controls.show = true;
    art.controls.show = false; // Touch tap may explicitly hide controls.
    expect(art.controls.show).toBe(false);
  });

  it('keeps keyboard-focused controls visible and resumes hiding after focus leaves', async () => {
    const { art, button, doc, root } = player();
    art.fullscreen = true;
    button.focusVisible = true; doc.activeElement = button;
    root.dispatchEvent(new Event('focusin'));
    await Promise.resolve();
    vi.advanceTimersByTime(5000);
    expect(art.controls.show).toBe(true);
    doc.activeElement = null;
    root.dispatchEvent(new Event('focusout'));
    await Promise.resolve();
    vi.advanceTimersByTime(3000);
    expect(art.controls.show).toBe(false);
  });

  it('removes timers, DOM listeners and observers when destroyed', () => {
    const { art, emit, dispose, pointer, disconnect } = player();
    art.fullscreenWeb = true;
    pointer('pointerenter');
    expect(vi.getTimerCount()).toBe(1);
    dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(disconnect).toHaveBeenCalled();
    art.controls.show = false;
    pointer('pointerenter');
    art.video.paused = true;
    emit('video:seeking');
    expect(art.controls.show).toBe(false);
  });
});

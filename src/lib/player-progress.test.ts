import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Artplayer from 'artplayer';
import { bindProgressSeek } from './player-progress';

describe('progress dragging', () => {
  let bar: EventTarget;
  let doc: EventTarget;
  let win: EventTarget;
  let cleanup: () => void;
  let seeks: number[];
  let time: number;
  let events: Map<string, () => void>;
  let preview: ReturnType<typeof vi.fn>;
  const pointer = (type: string, x: number, id = 1) => Object.assign(new Event(type, { cancelable: true }), {
    pointerId: id, isPrimary: true, button: 0, clientX: x,
  });
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (fn: () => void) => setTimeout(fn, 16));
    vi.stubGlobal('cancelAnimationFrame', clearTimeout);
    seeks = []; time = 10; events = new Map(); preview = vi.fn();
    win = new EventTarget();
    doc = Object.assign(new EventTarget(), { defaultView: win });
    bar = Object.assign(new EventTarget(), {
      ownerDocument: doc, style: { touchAction: '' },
      getBoundingClientRect: () => ({ left: 100, width: 1000 }),
      setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn(),
    });
    const art = {
      template: { $progress: bar, $player: { classList: { remove: vi.fn() } } }, duration: 100, controls: { show: false },
      get currentTime() { return time; },
      set seek(value: number) { seeks.push(value); time = value; },
      emit: vi.fn(),
      on: (name: string, fn: () => void) => events.set(name, fn),
      off: (name: string) => events.delete(name),
    } as unknown as Artplayer;
    cleanup = bindProgressSeek(art, preview);
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('previews many moves without seeking, then commits the release position exactly once', () => {
    bar.dispatchEvent(pointer('pointerdown', 200));
    for (let x = 210; x <= 800; x += 10) doc.dispatchEvent(pointer('pointermove', x));
    expect(seeks).toEqual([]);
    vi.advanceTimersByTime(16);
    expect(preview).toHaveBeenCalledTimes(1);
    expect(preview).toHaveBeenLastCalledWith(70);
    events.get('video:timeupdate')!(); vi.advanceTimersByTime(16);
    expect(preview).toHaveBeenLastCalledWith(70);
    doc.dispatchEvent(pointer('pointerup', 900));
    expect(seeks).toEqual([80]);
    expect(preview).toHaveBeenLastCalledWith(null);
    const click = Object.assign(new Event('click', { cancelable: true }), { detail: 1 });
    bar.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
  });
  it('commits a click even before the first animation frame and clamps outside the bar', () => {
    bar.dispatchEvent(pointer('pointerdown', 600)); doc.dispatchEvent(pointer('pointerup', 600));
    expect(seeks).toEqual([50]);
    bar.dispatchEvent(pointer('pointerdown', 600)); doc.dispatchEvent(pointer('pointerup', -100));
    bar.dispatchEvent(pointer('pointerdown', 600)); doc.dispatchEvent(pointer('pointerup', 2000));
    expect(seeks).toEqual([50, 0, 100]);
    vi.runAllTimers(); expect(preview).toHaveBeenLastCalledWith(null);
  });
  it.each(['pointercancel', 'blur', 'emptied', 'cleanup'])('abandons a drag on %s without changing playback', kind => {
    bar.dispatchEvent(pointer('pointerdown', 600));
    if (kind === 'pointercancel') doc.dispatchEvent(pointer('pointercancel', 600));
    if (kind === 'blur') win.dispatchEvent(new Event('blur'));
    if (kind === 'emptied') events.get('video:emptied')!();
    if (kind === 'cleanup') cleanup();
    doc.dispatchEvent(pointer('pointerup', 900)); vi.runAllTimers();
    expect(seeks).toEqual([]); expect(time).toBe(10);
    expect(preview).toHaveBeenLastCalledWith(null);
  });
  it('ignores other pointers and blocks ArtPlayer compatibility handlers during a drag', () => {
    bar.dispatchEvent(pointer('pointerdown', 600));
    doc.dispatchEvent(pointer('pointermove', 900, 2)); doc.dispatchEvent(pointer('pointerup', 900, 2));
    expect(seeks).toEqual([]);
    for (const type of ['mousedown', 'touchstart']) {
      const event = new Event(type, { cancelable: true }); bar.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
    doc.dispatchEvent(pointer('pointerup', 700)); expect(seeks).toEqual([60]);
  });
});

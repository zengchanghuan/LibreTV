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
  let delayed: boolean;
  let bounds: { left: number; width: number };
  let label: { textContent: string };
  let events: Map<string, () => void>;
  let preview: ReturnType<typeof vi.fn>;
  const pointer = (type: string, x: number, id = 1) => Object.assign(new Event(type, { cancelable: true }), {
    pointerId: id, isPrimary: true, button: 0, clientX: x,
  });
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (fn: () => void) => setTimeout(fn, 16));
    vi.stubGlobal('cancelAnimationFrame', clearTimeout);
    seeks = []; time = 10; delayed = false; events = new Map(); preview = vi.fn();
    bounds = { left: 100, width: 1000 }; label = { textContent: '' };
    win = new EventTarget();
    doc = Object.assign(new EventTarget(), { defaultView: win });
    bar = Object.assign(new EventTarget(), {
      ownerDocument: doc, style: { touchAction: '' },
      getBoundingClientRect: () => ({ ...bounds }),
      setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn(),
    });
    const art = {
      template: { $progress: bar, $player: { classList: { remove: vi.fn() }, querySelector: () => label } }, duration: 100, controls: { show: false },
      get currentTime() { return time; },
      notice: { show: '' },
      set seek(value: number) { seeks.push(value); if (!delayed) time = value; },
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
    events.get('video:seeked')!();
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
    events.get('video:seeked')!();
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
  it('keeps the requested time through stale buffering updates until the seek completes', () => {
    delayed = true;
    bar.dispatchEvent(pointer('pointerdown', 600)); doc.dispatchEvent(pointer('pointerup', 600));
    expect(time).toBe(10);
    expect(preview).toHaveBeenLastCalledWith(50);
    expect(label.textContent).toBe('00:50 / 01:40');
    for (const event of ['video:timeupdate', 'video:progress']) {
      label.textContent = '0:10 / 1:40';
      events.get(event)!();
      expect(preview).toHaveBeenLastCalledWith(50);
      expect(label.textContent).toBe('00:50 / 01:40');
    }
    time = 50; events.get('video:seeked')!();
    expect(preview).toHaveBeenLastCalledWith(null);
    expect(seeks).toEqual([50]);
  });
  it('keeps the original click position when revealing the controls changes the bar width', () => {
    bar.dispatchEvent(pointer('pointerdown', 600));
    bounds = { left: 98, width: 1004 };
    doc.dispatchEvent(pointer('pointerup', 600));
    expect(seeks).toEqual([50]);
  });
  it('uses the latest click while buffering and clears it on a source change or error', () => {
    delayed = true;
    for (const x of [600, 900]) {
      bar.dispatchEvent(pointer('pointerdown', x)); doc.dispatchEvent(pointer('pointerup', x));
    }
    events.get('video:timeupdate')!();
    expect(preview).toHaveBeenLastCalledWith(80);
    expect(seeks).toEqual([50, 80]);
    events.get('video:emptied')!();
    expect(preview).toHaveBeenLastCalledWith(null);
    bar.dispatchEvent(pointer('pointerdown', 600)); doc.dispatchEvent(pointer('pointerup', 600));
    events.get('video:error')!();
    expect(preview).toHaveBeenLastCalledWith(null);
  });
  it.each([false, true])('commits a physical click when capture is lost before pointerup (buffering: %s)', buffering => {
    if (buffering) {
      delayed = true;
      bar.dispatchEvent(pointer('pointerdown', 400)); doc.dispatchEvent(pointer('pointerup', 400));
    }
    // Recorded Chrome mouse sequence: down → preview → lostcapture → up → click.
    // Losing capture does not cancel the physical gesture; document still gets up.
    bar.dispatchEvent(pointer('pointerdown', 900));
    vi.advanceTimersByTime(16);
    expect(preview).toHaveBeenLastCalledWith(80);
    Object.assign(bar, { hasPointerCapture: () => false });
    bar.dispatchEvent(pointer('lostpointercapture', 900));
    expect(preview).toHaveBeenLastCalledWith(80);
    doc.dispatchEvent(pointer('pointerup', 900));
    expect(seeks).toEqual(buffering ? [30, 80] : [80]);
    expect(preview).toHaveBeenLastCalledWith(80);
    const click = Object.assign(new Event('click', { cancelable: true }), { detail: 1 });
    bar.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    doc.dispatchEvent(pointer('pointerup', 900));
    expect(seeks).toHaveLength(buffering ? 2 : 1);
  });
});

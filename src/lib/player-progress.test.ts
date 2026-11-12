import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Artplayer from 'artplayer';
import { bindProgressSeek } from './player-progress';

describe('progress synchronization and dragging', () => {
  let bar: EventTarget;
  let doc: EventTarget;
  let win: EventTarget;
  let cleanup: () => void;
  let seeks: number[];
  let time: number;
  let duration: number;
  let video: { seeking: boolean };
  let delayed: boolean;
  let bounds: { left: number; width: number };
  let label: { textContent: string };
  let events: Map<string, () => void>;
  let preview: ReturnType<typeof vi.fn>;
  let emit: ReturnType<typeof vi.fn>;
  const pointer = (type: string, x: number, id = 1) => Object.assign(new Event(type, { cancelable: true }), {
    pointerId: id, isPrimary: true, button: 0, clientX: x,
  });
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (fn: () => void) => setTimeout(fn, 16));
    vi.stubGlobal('cancelAnimationFrame', clearTimeout);
    seeks = []; time = 10; duration = 100; video = { seeking: false };
    delayed = false; events = new Map(); preview = vi.fn(); emit = vi.fn();
    bounds = { left: 100, width: 1000 }; label = { textContent: '' };
    win = new EventTarget();
    doc = Object.assign(new EventTarget(), { defaultView: win });
    bar = Object.assign(new EventTarget(), {
      ownerDocument: doc, style: { touchAction: '' },
      getBoundingClientRect: () => ({ ...bounds }),
      setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn(),
    });
    const art = {
      template: { $progress: bar, $player: { classList: { remove: vi.fn() }, querySelector: () => label } }, video, controls: { show: false },
      get duration() { return duration; },
      get currentTime() { return time; },
      notice: { show: '' },
      set seek(value: number) { seeks.push(value); video.seeking = true; if (!delayed) time = value; },
      emit,
      on: (name: string, fn: () => void) => events.set(name, fn),
      off: (name: string) => events.delete(name),
    } as unknown as Artplayer;
    cleanup = bindProgressSeek(art, preview);
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it.each(['video:timeupdate', 'video:loadedmetadata', 'video:pause'])('syncs the bar and label to the actual clock on %s without dragging', event => {
    for (const current of [11, 42, 90]) {
      time = current;
      events.get(event)!();
      expect(emit).toHaveBeenLastCalledWith('setBar', 'played', current / duration);
      expect(preview).toHaveBeenLastCalledWith(null);
    }
    expect(label.textContent).toBe('01:30 / 01:40');
    expect(seeks).toEqual([]);
  });
  it('resumes actual progress when a seek completes without a seeked event', () => {
    delayed = true;
    bar.dispatchEvent(pointer('pointerdown', 600)); doc.dispatchEvent(pointer('pointerup', 600));
    expect(preview).toHaveBeenLastCalledWith(50);
    time = 51; video.seeking = false;
    events.get('video:timeupdate')!();
    expect(emit).toHaveBeenLastCalledWith('setBar', 'played', 0.51);
    expect(label.textContent).toBe('00:51 / 01:40');
    expect(preview).toHaveBeenLastCalledWith(null);
    time = 52; events.get('video:timeupdate')!();
    expect(emit).toHaveBeenLastCalledWith('setBar', 'played', 0.52);
    expect(label.textContent).toBe('00:52 / 01:40');
    expect(seeks).toEqual([50]);
  });
  it('uses the actual clamped position when playing resumes before seeked', () => {
    delayed = true;
    bar.dispatchEvent(pointer('pointerdown', 1100)); doc.dispatchEvent(pointer('pointerup', 1100));
    expect(preview).toHaveBeenLastCalledWith(100);
    time = 99.5; video.seeking = false;
    events.get('video:playing')!();
    expect(emit).toHaveBeenLastCalledWith('setBar', 'played', 0.995);
    expect(label.textContent).toBe('01:39 / 01:40');
    expect(preview).toHaveBeenLastCalledWith(null);
  });
  it('recalculates progress when the duration changes without a new timeupdate', () => {
    time = 50; duration = 200;
    events.get('video:durationchange')!();
    expect(emit).toHaveBeenLastCalledWith('setBar', 'played', 0.25);
    expect(label.textContent).toBe('00:50 / 03:20');
    expect(preview).toHaveBeenLastCalledWith(null);
  });
  it('removes all media synchronization listeners on cleanup', () => {
    for (const event of ['video:timeupdate', 'video:progress', 'video:playing', 'video:loadedmetadata', 'video:durationchange', 'video:pause']) {
      expect(events.has(event)).toBe(true);
    }
    cleanup();
    expect(events.size).toBe(0);
  });

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
    video.seeking = false; events.get('video:seeked')!();
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
    video.seeking = false; events.get('video:seeked')!();
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
    for (const event of ['video:timeupdate', 'video:progress', 'video:playing', 'video:pause']) {
      label.textContent = '0:10 / 1:40';
      events.get(event)!();
      expect(preview).toHaveBeenLastCalledWith(50);
      expect(label.textContent).toBe('00:50 / 01:40');
      expect(emit).toHaveBeenLastCalledWith('setBar', 'played', 0.5);
    }
    time = 50; video.seeking = false; events.get('video:seeked')!();
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

import { afterEach, describe, expect, it, vi } from 'vitest';
import type Artplayer from 'artplayer';
import { bindPlaybackControls } from './player-controls';

function player() {
  const listeners = new Map<string, Set<(visible: boolean) => void>>();
  let visible = false;
  const emit = (event: string, value = false) => listeners.get(event)?.forEach(fn => fn(value));
  const art = {
    video: { paused: false, seeking: false, readyState: 4 },
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
  return { art, emit, dispose: bindPlaybackControls(art as unknown as Artplayer) };
}

afterEach(() => vi.useRealTimers());

describe('playback control visibility', () => {
  it('does not flash hidden controls when network activity repeats every 30 seconds', () => {
    vi.useFakeTimers();
    const { art, emit, dispose } = player();
    const timer = setInterval(() => {
      emit('video:stalled');
      art.video.readyState = 2;
      emit('video:waiting');
      art.controls.show = false;
      expect(art.controls.show).toBe(false);
      art.video.readyState = 4;
      emit('video:playing');
      expect(art.controls.show).toBe(false);
    }, 30_000);
    vi.advanceTimersByTime(90_000);
    clearInterval(timer);
    dispose();
  });

  it('keeps paused and seeking playback operable, then allows hiding after resume', () => {
    const { art, emit, dispose } = player();
    art.video.paused = true;
    art.controls.show = false;
    expect(art.controls.show).toBe(true);
    art.video.paused = false;
    art.video.seeking = true;
    emit('video:seeking');
    expect(art.controls.show).toBe(true);
    art.controls.show = false;
    expect(art.controls.show).toBe(true);
    art.video.seeking = false;
    art.controls.show = false;
    expect(art.controls.show).toBe(false);
    dispose();
  });

  it('removes listeners when the player is destroyed', () => {
    const { art, emit, dispose } = player();
    dispose();
    art.video.paused = true;
    emit('video:seeking');
    art.controls.show = false;
    expect(art.controls.show).toBe(false);
  });
});

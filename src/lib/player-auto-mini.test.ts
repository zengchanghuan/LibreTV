import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Artplayer from 'artplayer';
import { bindAutoMini } from './player-auto-mini';

describe('automatic floating player', () => {
  let cleanup: (() => void) | undefined;
  let top: number;
  let mini: boolean;
  let changes: boolean[];
  let events: Map<string, () => void>;
  let player: Artplayer;
  let removePopup: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', Object.assign(new EventTarget(), { innerHeight: 800, innerWidth: 1200 }));
    vi.stubGlobal('requestAnimationFrame', (fn: () => void) => setTimeout(fn, 16));
    vi.stubGlobal('cancelAnimationFrame', clearTimeout);
    top = 80; mini = false; changes = []; events = new Map();
    removePopup = vi.fn();
    player = {
      get mini() { return mini; }, set mini(value: boolean) { mini = value; changes.push(value); },
      fullscreen: false, fullscreenWeb: false, pip: false,
      template: { $mini: { remove: () => removePopup() }, $container: { getBoundingClientRect: () => ({ top, bottom: top + 500, left: 0, right: 900, width: 900, height: 500 }) } },
      on: (event: string, fn: () => void) => events.set(event, fn),
      off: (event: string) => events.delete(event),
    } as unknown as Artplayer;
    cleanup = bindAutoMini(player);
    vi.advanceTimersByTime(16);
  });
  afterEach(() => { cleanup?.(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  const scroll = () => window.dispatchEvent(new Event('scroll'));

  it('restores after the final fast scroll event, within the old 200ms throttle window', () => {
    top = -600; scroll(); vi.advanceTimersByTime(16);
    expect(mini).toBe(true);
    top = 80; scroll(); vi.advanceTimersByTime(16);
    expect(mini).toBe(false);
    expect(changes).toEqual([true, false]);
  });
  it('uses the final position when many events arrive in one frame, without repeated video moves', () => {
    top = -600; scroll(); top = 80; scroll(); vi.advanceTimersByTime(16);
    expect(changes).toEqual([]);
    top = -600; scroll(); vi.advanceTimersByTime(16);
    scroll(); vi.advanceTimersByTime(16);
    expect(changes).toEqual([true]);
  });
  it('restores a paused floating video when even part of a tall player is visible', () => {
    top = -600; scroll(); vi.advanceTimersByTime(16);
    top = -450; scroll(); vi.advanceTimersByTime(16);
    expect(mini).toBe(false);
  });
  it.each(['fullscreen', 'fullscreenWeb', 'pip'] as const)('does not override %s and rechecks on exit', mode => {
    player[mode] = true; top = -600; scroll(); vi.advanceTimersByTime(16);
    expect(mini).toBe(false);
    player[mode] = false; events.get(mode)!(); vi.advanceTimersByTime(16);
    expect(mini).toBe(true);
  });
  it('removes an already hidden popup and makes cleanup idempotent', () => {
    top = -600; scroll(); vi.advanceTimersByTime(16);
    player.mini = false;
    cleanup!(); cleanup!(); cleanup = undefined;
    expect(removePopup).toHaveBeenCalledOnce();
    expect(mini).toBe(false);
  });
  it('rechecks resize and disconnects pending work/listeners when the player unmounts', () => {
    top = 900; window.dispatchEvent(new Event('resize')); vi.advanceTimersByTime(16);
    expect(mini).toBe(true);
    top = 80; scroll(); cleanup!(); cleanup = undefined;
    vi.runAllTimers(); scroll(); window.dispatchEvent(new Event('resize')); vi.runAllTimers();
    expect(mini).toBe(false);
    expect(removePopup).toHaveBeenCalledOnce();
    expect(events.size).toBe(0);
  });
});

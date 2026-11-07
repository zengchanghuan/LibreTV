import { describe, expect, it, vi } from 'vitest';
import type Artplayer from 'artplayer';
import { bindEarlyFullscreen } from './player-fullscreen';

function fixture({ webkit = false, supported = true, enabled = true } = {}) {
  const doc = Object.assign(new EventTarget(), {
    fullscreenEnabled: enabled, webkitFullscreenEnabled: enabled,
    fullscreenElement: null as unknown, webkitFullscreenElement: null as unknown,
    exitFullscreen: undefined as unknown, webkitExitFullscreen: undefined as unknown,
  });
  const classes = new Set<string>();
  const player = {
    ownerDocument: doc,
    classList: { toggle: (name: string, on: boolean) => on ? classes.add(name) : classes.delete(name) },
    requestFullscreen: undefined as unknown, webkitRequestFullscreen: undefined as unknown,
  };
  const change = (element: unknown) => {
    if (webkit) doc.webkitFullscreenElement = element;
    else doc.fullscreenElement = element;
    doc.dispatchEvent(new Event(webkit ? 'webkitfullscreenchange' : 'fullscreenchange'));
  };
  const request = vi.fn(function (this: unknown): void | Promise<void> {
    expect(this).toBe(player);
    change(player);
    return Promise.resolve();
  });
  const exit = vi.fn(function (this: unknown) {
    expect(this).toBe(doc);
    change(null);
    return Promise.resolve();
  });
  if (supported) {
    if (webkit) { player.webkitRequestFullscreen = request; doc.webkitExitFullscreen = exit; }
    else { player.requestFullscreen = request; doc.exitFullscreen = exit; }
  }
  const events = new Map<string, () => void>();
  const art = {
    template: { $player: player }, video: { readyState: 0 },
    fullscreenWeb: false, isDestroy: false, state: 'standard', notice: { show: '' },
    emit: vi.fn(),
    on: (name: string, fn: () => void) => events.set(name, fn),
    off: (name: string) => events.delete(name),
  } as unknown as Artplayer;
  const cleanup = bindEarlyFullscreen(art);
  return { art, player, doc, classes, request, exit, events, change, cleanup };
}

// Fullscreen promises settle independently of metadata or decoded media.
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

describe('fullscreen before video metadata', () => {
  it.each([false, true])('enters and exits immediately with the native API (webkit=%s)', async webkit => {
    const f = fixture({ webkit });
    f.art.fullscreen = true;
    expect(f.request).toHaveBeenCalledOnce();
    expect(f.art.video.readyState).toBe(0);
    expect(f.art.fullscreen).toBe(true);
    expect(f.art.state).toBe('fullscreen');
    expect(f.classes.has('art-fullscreen')).toBe(true);
    expect(f.art.emit).toHaveBeenCalledWith('fullscreen', true);
    await settle();
    f.art.fullscreen = false;
    expect(f.exit).toHaveBeenCalledOnce();
    expect(f.art.fullscreen).toBe(false);
    expect(f.classes.has('art-fullscreen')).toBe(false);
    expect(f.art.emit).toHaveBeenCalledWith('fullscreen', false);
    f.cleanup();
  });

  it('tracks Escape and ignores another element entering fullscreen', () => {
    const f = fixture();
    f.art.fullscreen = true;
    f.change(null);
    expect(f.art.fullscreen).toBe(false);
    expect(f.classes.has('art-fullscreen')).toBe(false);
    const emitted = vi.mocked(f.art.emit).mock.calls.length;
    f.change({});
    expect(f.art.fullscreen).toBe(false);
    expect(vi.mocked(f.art.emit).mock.calls.length).toBe(emitted);
    f.cleanup();
  });

  it.each([{ supported: false }, { enabled: false }])('toggles web fullscreen when native fullscreen is unavailable: %j', options => {
    const f = fixture(options);
    f.art.fullscreen = true;
    expect(f.art.fullscreenWeb).toBe(true);
    f.art.fullscreen = true;
    expect(f.art.fullscreenWeb).toBe(false);
    expect(f.request).not.toHaveBeenCalled();
    f.cleanup();
  });

  it.each(['reject', 'throw'])('falls back when the native request fails (%s)', async failure => {
    const f = fixture();
    f.request.mockImplementation(() => {
      if (failure === 'throw') throw new Error('Fullscreen unavailable');
      return Promise.reject(new Error('Fullscreen denied'));
    });
    f.art.fullscreen = true;
    await settle();
    expect(f.art.fullscreenWeb).toBe(true);
    expect(f.art.fullscreen).toBe(false);
    f.art.fullscreen = !f.art.fullscreen;
    expect(f.art.fullscreenWeb).toBe(false);
    expect(f.request).toHaveBeenCalledOnce();
    f.cleanup();
  });

  it('does not send duplicate requests while native fullscreen is pending', async () => {
    const f = fixture();
    let complete!: () => void;
    f.request.mockImplementation(() => new Promise<void>(resolve => { complete = resolve; }));
    f.art.fullscreen = true;
    f.art.fullscreen = true;
    expect(f.request).toHaveBeenCalledOnce();
    complete(); await settle();
    f.cleanup();
  });

  it('handles WebKit reporting failure only via an event, without a returned promise', () => {
    const f = fixture({ webkit: true });
    f.request.mockImplementation(() => {});
    f.art.fullscreen = true;
    f.art.fullscreen = true;
    expect(f.request).toHaveBeenCalledOnce();
    f.doc.dispatchEvent(new Event('webkitfullscreenerror'));
    expect(f.art.fullscreenWeb).toBe(true);
    f.doc.dispatchEvent(new Event('webkitfullscreenerror'));
    expect(f.art.fullscreenWeb).toBe(true);
    f.cleanup();
  });

  it('handles a native error event and promise rejection without toggling the fallback off', async () => {
    const f = fixture();
    f.request.mockImplementation(() => {
      f.doc.dispatchEvent(new Event('fullscreenerror'));
      return Promise.reject(new Error('Denied'));
    });
    f.art.fullscreen = true;
    await settle();
    expect(f.art.fullscreenWeb).toBe(true);
    f.cleanup();
  });

  it('keeps web fullscreen open if the user opened it while the native request was pending', async () => {
    const f = fixture();
    let reject!: (err: Error) => void;
    f.request.mockImplementation(() => new Promise<void>((_, fail) => { reject = fail; }));
    f.art.fullscreen = true;
    f.art.fullscreenWeb = true;
    reject(new Error('Denied')); await settle();
    expect(f.art.fullscreenWeb).toBe(true);
    f.cleanup();
  });

  it('leaves an active fullscreen session intact when ArtPlayer takes over after metadata', async () => {
    const f = fixture();
    f.art.fullscreen = true;
    await settle();
    const setter = vi.fn();
    const getter = () => f.doc.fullscreenElement === f.player;
    Object.defineProperty(f.art, 'fullscreen', { get: getter, set: setter });
    f.events.get('video:loadedmetadata')!();
    expect(f.art.fullscreen).toBe(true);
    expect(f.classes.has('art-fullscreen')).toBe(true);
    vi.mocked(f.art.emit).mockClear();
    f.change(null);
    expect(f.art.emit).not.toHaveBeenCalled(); // Only ArtPlayer should emit now.
    f.art.fullscreen = false;
    expect(setter).toHaveBeenCalledWith(false);
    f.cleanup();
    expect(Object.getOwnPropertyDescriptor(f.art, 'fullscreen')?.get).toBe(getter);
  });

  it('does not replace a fullscreen accessor already initialized by ArtPlayer', () => {
    const f = fixture();
    const getter = Object.getOwnPropertyDescriptor(f.art, 'fullscreen')?.get;
    const cleanup = bindEarlyFullscreen(f.art);
    cleanup();
    expect(Object.getOwnPropertyDescriptor(f.art, 'fullscreen')?.get).toBe(getter);
    f.cleanup();
  });

  it('cleans up listeners and never opens web fullscreen after unmount', async () => {
    const f = fixture();
    let reject!: (err: Error) => void;
    f.request.mockImplementation(() => new Promise<void>((_, fail) => { reject = fail; }));
    f.art.fullscreen = true;
    f.cleanup();
    reject(new Error('Interrupted')); await settle();
    f.change(f.player);
    expect(f.art.fullscreenWeb).toBe(false);
    expect(f.art.emit).not.toHaveBeenCalled();
    expect(f.events.size).toBe(0);
    expect(Object.hasOwn(f.art, 'fullscreen')).toBe(false);
  });
});

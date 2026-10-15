import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseNativeProgress, scheduleNativeAutoOpen } from './native-player';
const event = { eventId: 'event', sessionId: 'session', profileId: null, sourceKey: 'source', vodId: 'video', title: '标题', index: 1, total: 3, position: 120, duration: 1800, sequence: 3, baseRevision: 0, openedAt: 1, ended: false, reason: 'progress' };
describe('native bridge boundary', () => {
  it('accepts a valid bounded playback event', () => expect(parseNativeProgress(event)).toEqual(event));
  it.each([{ position: Infinity }, { duration: -1 }, { index: 3 }, { sequence: 2.2 }, { total: 10001 }, { sourceUrl: 'javascript:alert(1)' }, { profileId: 'other' }, { reason: 'unknown' }])('rejects malformed native payload %o', change => expect(parseNativeProgress({ ...event, ...change })).toBeNull());
});

describe('automatic native playback entry', () => {
  const cleanups: (() => void)[] = [];
  const schedule = (open: () => void, attempted: { current: boolean }, ready = true) => {
    const cleanup = scheduleNativeAutoOpen(open, attempted, ready);
    cleanups.push(cleanup);
    return cleanup;
  };
  beforeEach(() => {
    vi.useFakeTimers();
    const browser = Object.assign(new EventTarget(), { __LIBRETV_NATIVE__: { version: 1, platform: 'ios', postMessage: vi.fn() } });
    vi.stubGlobal('window', browser);
  });
  afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); vi.useRealTimers(); vi.unstubAllGlobals(); });
  it('opens once and stays closed when the bridge announces readiness again', () => {
    const open = vi.fn(), attempted = { current: false };
    schedule(open, attempted);
    vi.runAllTimers();
    window.dispatchEvent(new Event('libretv:native-ready'));
    schedule(open, attempted);
    vi.runAllTimers();
    expect(open).toHaveBeenCalledTimes(1);
  });
  it('waits for episode details so a direct-URL placeholder does not become the whole session', () => {
    const open = vi.fn(), attempted = { current: false };
    schedule(open, attempted, false);
    vi.runAllTimers();
    window.dispatchEvent(new Event('libretv:native-ready'));
    expect(open).not.toHaveBeenCalled();
    schedule(open, attempted);
    vi.runAllTimers();
    expect(open).toHaveBeenCalledOnce();
  });
  it('waits for a late Android bridge before opening', () => {
    const open = vi.fn(), attempted = { current: false };
    delete window.__LIBRETV_NATIVE__;
    schedule(open, attempted);
    vi.runAllTimers();
    expect(open).not.toHaveBeenCalled();
    window.__LIBRETV_NATIVE__ = { version: 1, platform: 'android', postMessage: vi.fn() };
    window.dispatchEvent(new Event('libretv:native-ready'));
    expect(open).toHaveBeenCalledOnce();
  });
  it('cancels on navigation away and survives the Strict Mode setup/cleanup cycle', () => {
    const open = vi.fn(), attempted = { current: false };
    schedule(open, attempted)();
    vi.runAllTimers();
    window.dispatchEvent(new Event('libretv:native-ready'));
    expect(open).not.toHaveBeenCalled();
    schedule(open, attempted);
    vi.runAllTimers();
    expect(open).toHaveBeenCalledOnce();
  });
});

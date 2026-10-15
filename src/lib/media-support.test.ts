import { describe, expect, it } from 'vitest';
import { hlsEngine, sleepTimerExpired } from './media-support';
describe('mobile playback capability selection', () => {
  it('retains hls.js features when available and supports native-only Safari', () => {
    expect(hlsEngine(true, 'maybe')).toBe('hls');
    expect(hlsEngine(false, 'maybe')).toBe('native');
    expect(hlsEngine(false, '')).toBe('unsupported');
  });
  it('uses elapsed wall time even when background timers skip ticks', () => {
    const start = 1_000_000, deadline = start + 15 * 60_000;
    expect(sleepTimerExpired(null, deadline)).toBe(false);
    expect(sleepTimerExpired(deadline, start + 14 * 60_000)).toBe(false);
    expect(sleepTimerExpired(deadline, start + 40 * 60_000)).toBe(true);
  });
});

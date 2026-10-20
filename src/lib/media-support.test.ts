import { describe, expect, it } from 'vitest';
import { hasPlaybackHeadroom, hlsEngine, sleepTimerExpired } from './media-support';
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

describe('playback bandwidth priority', () => {
  const video = (ranges: number[][], rate = 1) => ({
    currentTime: 100, playbackRate: rate, readyState: 4, seeking: false,
    buffered: { length: ranges.length, start: (i: number) => ranges[i][0], end: (i: number) => ranges[i][1] },
  });
  it('keeps background downloads off until the current range has 30 seconds ahead', () => {
    expect(hasPlaybackHeadroom(video([[90, 129]]))).toBe(false);
    expect(hasPlaybackHeadroom(video([[90, 130]]))).toBe(true);
  });
  it('reserves proportionally more buffer at higher playback speeds', () => {
    expect(hasPlaybackHeadroom(video([[90, 150]], 2))).toBe(false);
    expect(hasPlaybackHeadroom(video([[90, 160]], 2))).toBe(true);
    expect(hasPlaybackHeadroom(video([[90, 180]], 3))).toBe(false);
  });
  it('does not count disconnected future ranges or buffers behind a seek', () => {
    expect(hasPlaybackHeadroom(video([[0, 90], [110, 200]]))).toBe(false);
    expect(hasPlaybackHeadroom(video([[90, 105], [110, 200]]))).toBe(false);
    expect(hasPlaybackHeadroom({ ...video([[90, 200]]), seeking: true })).toBe(false);
    expect(hasPlaybackHeadroom({ ...video([[90, 200]]), readyState: 2 })).toBe(false);
  });
});

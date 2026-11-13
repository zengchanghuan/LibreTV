import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The store runs in a browser in production; give persistence an in-memory backend.
vi.stubGlobal('window', { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
const { usePlaybackQuality } = await import('./playback-quality-store');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-13T12:00:00Z'));
  usePlaybackQuality.setState({ entries: {} });
});
afterEach(() => vi.useRealTimers());

describe('playback history during retesting', () => {
  it('retains startup, stalls and failures when samples are replaced or invalidated', () => {
    const store = usePlaybackQuality.getState();
    store.record('source', { startupMs: 1500, playedMs: 30000, stalledMs: 2000, stalls: 2, failed: true });
    const history = { ...usePlaybackQuality.getState().entries.source };
    vi.advanceTimersByTime(60000);
    store.probe('source', { ok: true, ms: 700, kbps: 4000 });
    expect(usePlaybackQuality.getState().entries.source).toMatchObject(history);
    store.resetNetwork();
    expect(usePlaybackQuality.getState().entries.source).toEqual({ ...history, probe: undefined });
  });
  it('does not extend the lifetime of playback history through repeated probes', () => {
    const store = usePlaybackQuality.getState();
    store.record('source', { startupMs: 1500, playedMs: 30000, stalledMs: 2000, stalls: 2 });
    vi.advanceTimersByTime(6 * 86400000);
    store.probe('source', { ok: true, ms: 700 });
    vi.advanceTimersByTime(2 * 86400000);
    store.probe('source', { ok: true, ms: 800 });
    expect(usePlaybackQuality.getState().entries.source).toMatchObject({ starts: 0, playedMs: 0, stalledMs: 0, stalls: 0 });
    expect(usePlaybackQuality.getState().entries.source.startupMs).toBeUndefined();
  });
});

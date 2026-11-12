import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerAutoNext } from './player-auto-next';

describe('PlayerAutoNext', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('advances one episode after the end-of-playback delay', () => {
    const next = new PlayerAutoNext();
    const onEpisode = vi.fn();
    next.schedule({ enabled: true, index: 1, count: 4, onEpisode });
    vi.advanceTimersByTime(799);
    expect(onEpisode).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onEpisode).toHaveBeenCalledWith(2);
    vi.runAllTimers();
    expect(onEpisode).toHaveBeenCalledTimes(1);
  });

  it('lets manual navigation cancel the queued next episode', () => {
    const next = new PlayerAutoNext();
    const onEpisode = vi.fn();
    next.schedule({ enabled: true, index: 1, count: 4, onEpisode });
    vi.advanceTimersByTime(400);
    next.cancel();
    vi.runAllTimers();
    expect(onEpisode).not.toHaveBeenCalled();
  });

  it('does not advance when disabled, on a single film, or after the last episode', () => {
    const next = new PlayerAutoNext();
    const onEpisode = vi.fn();
    for (const options of [
      { enabled: false, index: 0, count: 4 },
      { enabled: true, index: 0, count: 1 },
      { enabled: true, index: 0, count: 0 },
      { enabled: true, index: 3, count: 4 },
    ]) {
      next.schedule({ ...options, onEpisode });
      vi.runAllTimers();
    }
    expect(onEpisode).not.toHaveBeenCalled();
  });

  it('repeated ended events retain only one scheduled transition', () => {
    const next = new PlayerAutoNext();
    const onEpisode = vi.fn();
    next.schedule({ enabled: true, index: 0, count: 4, onEpisode });
    vi.advanceTimersByTime(400);
    next.schedule({ enabled: true, index: 0, count: 4, onEpisode });
    vi.runAllTimers();
    expect(onEpisode.mock.calls).toEqual([[1]]);
  });

  it('can schedule a later episode after cancellation', () => {
    const next = new PlayerAutoNext();
    const onEpisode = vi.fn();
    next.schedule({ enabled: true, index: 0, count: 4, onEpisode });
    next.cancel();
    next.schedule({ enabled: true, index: 2, count: 4, onEpisode });
    vi.runAllTimers();
    expect(onEpisode.mock.calls).toEqual([[3]]);
  });
});

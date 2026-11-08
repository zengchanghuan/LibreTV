import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('./fetch-utils', () => ({ fetchUpstream: vi.fn(), getCache: vi.fn(), setCache: vi.fn() }));
afterEach(() => vi.useRealTimers());
describe('hot list stale fallback', () => {
  it('returns dated last-good data on failure, backs off, then recovers', async () => {
    vi.resetModules(); vi.useFakeTimers();
    const { fetchUpstream } = await import('./fetch-utils');
    vi.mocked(fetchUpstream).mockResolvedValue(Response.json({ data: [{ id: 1, title: '测试影片', cover: 'https://example.com/p.jpg' }] }));
    const { fetchHotListResult } = await import('./douban-weekly');
    const first = await fetchHotListResult('douban_movie_weekly');
    expect(first.stale).toBe(false);
    vi.advanceTimersByTime(3600001);
    vi.mocked(fetchUpstream).mockRejectedValue(new Error('offline'));
    const stale = await fetchHotListResult('douban_movie_weekly');
    expect(stale).toEqual({ ...first, stale: true });
    const calls = vi.mocked(fetchUpstream).mock.calls.length;
    await fetchHotListResult('douban_movie_weekly');
    expect(fetchUpstream).toHaveBeenCalledTimes(calls);
    vi.advanceTimersByTime(60001);
    vi.mocked(fetchUpstream).mockResolvedValue(Response.json({ data: [{ id: 2, title: '新榜单', cover: 'https://example.com/p.jpg' }] }));
    const fresh = await fetchHotListResult('douban_movie_weekly');
    expect(fresh.stale).toBe(false); expect(fresh.items[0].title).toBe('新榜单');
    expect(fresh.updatedAt).not.toBe(first.updatedAt);
  });
});

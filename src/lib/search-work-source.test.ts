import { beforeEach, describe, expect, it, vi } from 'vitest';
import { searchWorkSource } from './search-work-source';
import { searchSource } from './search-source';
import { readSourceVideoDetails } from './source-video-details';
import { buildSearchPlan, contextForFilm } from './work-search';

vi.mock('./search-source', () => ({ searchSource: vi.fn() }));
vi.mock('./source-video-details', () => ({ readSourceVideoDetails: vi.fn() }));
const source = { key: 'a', name: 'A', url: 'https://source.example/api.php' };
const original = '光海，成为王的男人';
const plan = buildSearchPlan(original, contextForFilm(original, 2012, 'movie'));
const item = (name: string, vodId: string, year?: string, typeName?: string) => ({ name, vodId, year, typeName, sourceKey: 'a', sourceName: 'A' });
beforeEach(() => vi.resetAllMocks());

describe('one source across multiple titles', () => {
  it('queries the second title even after a successful first match, deduplicates and reports progress', async () => {
    const shared = item('双面君王', 'shared', '2012', '电影');
    vi.mocked(searchSource).mockImplementation(async (_source, title) => ({ sourceKey: 'a', ok: true,
      list: [shared, item(title, title, '2012', '电影')] }));
    const onProgress = vi.fn();
    const result = await searchWorkSource(source, plan, { onProgress });
    expect(vi.mocked(searchSource).mock.calls.map(c => c[1])).toEqual(['双面君王', original]);
    expect(result.ok).toBe(true); expect(result.partial).toBeUndefined(); expect(result.list).toHaveLength(3);
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(readSourceVideoDetails).not.toHaveBeenCalled();
  });

  it('retains the healthy title result on a partial alias failure without declaring the source unhealthy', async () => {
    vi.mocked(searchSource).mockImplementation(async (_source, title) => ({ sourceKey: 'a', ok: title === original,
      list: title === original ? [item(original, '1', '2012', '电影')] : [], timedOut: title !== original }));
    const result = await searchWorkSource(source, plan);
    expect(result).toMatchObject({ ok: true, partial: true }); expect(result.list).toHaveLength(1);
  });

  it('fills missing identity from details and drops results whose details contradict the target', async () => {
    vi.mocked(searchSource).mockResolvedValue({ sourceKey: 'a', ok: true, list: [item(original, 'good'), item(original, 'wrong'), item(original, 'still-unknown')] });
    vi.mocked(readSourceVideoDetails).mockImplementation(async (_source, id) => ({ sourceKey: 'a', sourceName: 'A',
      title: original, year: id === 'good' ? '2012' : id === 'wrong' ? '2019' : undefined, typeName: '电影' }));
    const result = await searchWorkSource(source, plan);
    expect(result.list.map(i => i.vodId)).toEqual(['good', 'still-unknown']);
    expect(result.list[0].workId).toBe('tmdb:movie:133200');
    expect(result.list[1].identityUnconfirmed).toBe(true);
    expect(readSourceVideoDetails).toHaveBeenCalledTimes(3);
  });

  it('keeps unconfirmed results when detail requests fail and caps detail lookups at three', async () => {
    vi.mocked(searchSource).mockResolvedValue({ sourceKey: 'a', ok: true,
      list: Array.from({ length: 8 }, (_, i) => item(original, String(i))) });
    vi.mocked(readSourceVideoDetails).mockRejectedValue(new Error('timeout'));
    const result = await searchWorkSource(source, plan);
    expect(result).toMatchObject({ ok: true, partial: true });
    expect(result.list).toHaveLength(8); expect(result.list.every(i => i.identityUnconfirmed)).toBe(true);
    expect(readSourceVideoDetails).toHaveBeenCalledTimes(3);
  });

  it('returns successful results at the total deadline even when a pending request ignores abort', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(searchSource).mockImplementation(async (_source, title) => title === original
        ? new Promise(() => {}) : { sourceKey: 'a', ok: true, list: [item('双面君王', '1', '2012', '电影')] });
      const pending = searchWorkSource(source, plan, { timeoutMs: 100 });
      await vi.advanceTimersByTimeAsync(101);
      const result = await pending;
      expect(result).toMatchObject({ ok: true, partial: true, timedOut: true });
      expect(result.list).toHaveLength(1);
    } finally { vi.useRealTimers(); }
  });

  it('does not issue requests after cancellation', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(searchWorkSource(source, plan, { signal: controller.signal })).rejects.toThrow();
    expect(searchSource).not.toHaveBeenCalled();
  });
});

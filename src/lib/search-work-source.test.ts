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

  it('enriches manual single-title searches, retaining the raw listing and a usable pending entry on failure', async () => {
    const manual = buildSearchPlan('未收录剧集');
    vi.mocked(searchSource).mockResolvedValue({ sourceKey: 'a', ok: true,
      list: [item('未收录剧集', 'good'), item('未收录剧集', 'failed')] });
    vi.mocked(readSourceVideoDetails).mockImplementation(async (_source, id) => {
      if (id === 'failed') throw new Error('timeout');
      return { sourceKey: 'a', sourceName: 'A', title: '未收录剧集', year: '2020', typeName: '电视剧' };
    });
    const result = await searchWorkSource(source, manual);
    expect(result.list).toHaveLength(2);
    expect(result.list.find(i => i.vodId === 'good')).toMatchObject({
      year: undefined, identityUnconfirmed: undefined, identityDetails: { year: '2020', typeName: '电视剧' },
    });
    expect(result.list.find(i => i.vodId === 'failed')?.identityUnconfirmed).toBe(true);
    expect(readSourceVideoDetails).toHaveBeenCalledTimes(2);
  });

  it('checks conflicts on manual searches and preserves raw values after a staff-supported correction', async () => {
    vi.mocked(searchSource).mockResolvedValue({ sourceKey: 'a', ok: true, list: [item('双面君王', '1', '2013', '电影')] });
    vi.mocked(readSourceVideoDetails).mockResolvedValue({ sourceKey: 'a', sourceName: 'A', title: '双面君王',
      year: '2013', typeName: '电影', director: '秋昌民', actor: '李秉宪,柳承龙' });
    const result = await searchWorkSource(source, buildSearchPlan('双面君王'));
    expect(result.list[0]).toMatchObject({ year: '2013', workId: 'tmdb:movie:133200' });
    expect(result.list[0].identityUnconfirmed).toBeUndefined();
    expect(readSourceVideoDetails).toHaveBeenCalledTimes(1);
  });

  it('looks up the joined-year conflict from the mobile screenshot and does not merge mixed 360 metadata', async () => {
    vi.mocked(searchSource).mockResolvedValue({ sourceKey: 'a', ok: true, list: [
      item('双面君王2012', '5342', '2019', '剧情片'), item('双面君王2012', 'movie', '2012', '剧情片'),
    ] });
    vi.mocked(readSourceVideoDetails).mockResolvedValue({ sourceKey: 'a', sourceName: 'A', title: '双面君王2012',
      year: '2019', typeName: '剧情片', director: '金希元', actor: '吕珍九,李世荣,金相庆,权海骁,张光,' });
    const result = await searchWorkSource(source, buildSearchPlan('双面君王'));
    expect(result.list).toHaveLength(2);
    expect(result.list.find(i => i.vodId === 'movie')).toMatchObject({ workId: 'tmdb:movie:133200', identityUnconfirmed: undefined });
    expect(result.list.find(i => i.vodId === '5342')).toMatchObject({ identityUnconfirmed: true, identityReason: '标题年份与片源资料不一致' });
    expect(readSourceVideoDetails).toHaveBeenCalledTimes(1);
    expect(vi.mocked(readSourceVideoDetails).mock.calls[0][1]).toBe('5342');
  });
});

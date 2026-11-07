import { beforeEach, describe, expect, it, vi } from 'vitest';
import { matchWorkSources } from './recommendation-resources';
import { searchSource } from './search-source';
import { detailSite, siteAdapterFor } from './site-adapters/site-adapters';
import { getCache, setCache } from './fetch-utils';
import { seedWork } from './recommendations';

vi.mock('./search-source', () => ({ searchSource: vi.fn() }));
vi.mock('./site-adapters/site-adapters', () => ({ detailSite: vi.fn(), siteAdapterFor: vi.fn(() => '4kvm') }));
vi.mock('./fetch-utils', () => ({ fetchUpstream: vi.fn(), getCache: vi.fn(), setCache: vi.fn() }));
const source = { key: 'a', name: 'A', url: 'https://a.example/' };
const work = seedWork({ title: '老男孩', year: '2003', typeName: '电影', sourceKey: '', sourceName: '' });
const signal = () => new AbortController().signal;
const result = (extra = {}) => ({ sourceKey: source.key, sourceName: source.name, sourceUrl: source.url, vodId: '2003', name: '老男孩', year: '2003', typeName: '电影', ...extra });
beforeEach(() => {
  vi.resetAllMocks(); vi.mocked(siteAdapterFor).mockReturnValue('4kvm');
  vi.mocked(searchSource).mockResolvedValue({ sourceKey: source.key, ok: true, list: [result()] });
});

describe('cross-source work matching', () => {
  it('aggregates multiple sources, drops remakes and does not fetch known identity details', async () => {
    vi.mocked(searchSource).mockImplementation(async s => ({ sourceKey: s.key, ok: true,
      list: [result({ sourceKey: s.key, sourceUrl: s.url }), result({ vodId: '2013', year: '2013' }), result({ vodId: 'tv', typeName: '韩剧' })] }));
    const data = await matchWorkSources(work, [source, { ...source, key: 'b', url: 'https://b.example/' }], true, signal());
    expect(data.items).toHaveLength(2); expect(data.checked).toBe(2); expect(data.failures).toEqual([]);
    expect(detailSite).not.toHaveBeenCalled();
    expect(searchSource).toHaveBeenCalledWith(source, '老男孩', expect.objectContaining({ maxPages: 1, timeoutMs: 5000 }));
  });
  it('fills missing years from detail and rejects a wrong-year detail', async () => {
    vi.mocked(searchSource).mockResolvedValue({ sourceKey: 'a', ok: true, list: [result({ year: undefined })] });
    vi.mocked(detailSite).mockResolvedValue({ episodes: ['https://video.example/a.m3u8'], videoInfo: { title: '老男孩', year: '2013', sourceKey: 'a', sourceName: 'A' } });
    expect((await matchWorkSources(work, [source], true, signal())).items).toEqual([]);
    vi.mocked(detailSite).mockResolvedValue({ episodes: [], videoInfo: { title: '老男孩', year: '2003', sourceKey: 'a', sourceName: 'A' } });
    expect((await matchWorkSources(work, [source], true, signal())).items).toHaveLength(1);
  });
  it('never turns missing detail years or detail failures into confirmed availability', async () => {
    vi.mocked(searchSource).mockResolvedValue({ sourceKey: 'a', ok: true, list: [result({ year: undefined })] });
    vi.mocked(detailSite).mockResolvedValue({ episodes: [], videoInfo: { title: '老男孩', sourceKey: 'a', sourceName: 'A' } });
    expect((await matchWorkSources(work, [source], true, signal())).items).toEqual([]);
    vi.mocked(detailSite).mockRejectedValue(new Error('timeout'));
    vi.mocked(setCache).mockClear();
    const data = await matchWorkSources(work, [source], true, signal());
    expect(data.failures).toHaveLength(1); expect(setCache).not.toHaveBeenCalled();
  });
  it('retains successful sources when another source fails and reuses resource cache', async () => {
    vi.mocked(searchSource).mockImplementation(async s => ({ sourceKey: s.key, ok: s.key === 'a', list: s.key === 'a' ? [result()] : [], error: 'timeout' }));
    const data = await matchWorkSources(work, [source, { ...source, key: 'b', url: 'https://b.example/' }], true, signal());
    expect(data.items).toHaveLength(1); expect(data.failures).toHaveLength(1);
    expect(setCache).toHaveBeenCalledTimes(1);
    vi.mocked(getCache).mockReturnValue(data.items);
    vi.mocked(searchSource).mockClear();
    expect((await matchWorkSources(work, [source], true, signal())).items).toHaveLength(1);
    expect(searchSource).not.toHaveBeenCalled();
  });
  it('continues after one detail fails and keeps a later match from the same source', async () => {
    vi.mocked(searchSource).mockResolvedValue({ sourceKey: 'a', ok: true, list: [result({ vodId: 'broken', year: undefined }), result()] });
    vi.mocked(detailSite).mockRejectedValue(new Error('timeout'));
    const data = await matchWorkSources(work, [source], true, signal());
    expect(data.items.map(i => i.vodId)).toEqual(['2003']);
    expect(data.failures).toHaveLength(1);
    expect(setCache).not.toHaveBeenCalled();
  });
  it('limits detail lookups without truncating later confirmed matches', async () => {
    vi.mocked(searchSource).mockResolvedValue({ sourceKey: 'a', ok: true, list: [
      ...Array.from({ length: 4 }, (_, i) => result({ vodId: `unknown-${i}`, year: undefined })), result(),
    ] });
    vi.mocked(detailSite).mockResolvedValue({ episodes: [], videoInfo: { title: '老男孩', year: '2013', sourceKey: 'a', sourceName: 'A' } });
    const data = await matchWorkSources(work, [source], true, signal());
    expect(data.items.map(i => i.vodId)).toEqual(['2003']);
    expect(detailSite).toHaveBeenCalledTimes(3);
  });
  it('does not drop other sources when one source exhausts its whole-request deadline', async () => {
    const deadlines: AbortController[] = [];
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      const controller = new AbortController(); deadlines.push(controller); return controller.signal;
    });
    try {
      vi.mocked(searchSource).mockImplementation((s, _query, options) => s.key === 'a'
        ? new Promise((_resolve, reject) => options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason), { once: true }))
        : Promise.resolve({ sourceKey: s.key, ok: true, list: [result({ sourceKey: s.key, sourceUrl: s.url })] }));
      const pending = matchWorkSources(work, [source, { ...source, key: 'b', url: 'https://b.example/' }], true, signal());
      deadlines[0].abort(new DOMException('timeout', 'TimeoutError'));
      const data = await pending;
      expect(data.items.map(i => i.sourceKey)).toEqual(['b']);
      expect(data.failures.map(i => i.sourceKey)).toEqual(['a']);
      expect(timeout).toHaveBeenCalledWith(10000);
    } finally { timeout.mockRestore(); }
  });
  it('applies adult filtering to both search and enriched detail classifications', async () => {
    vi.mocked(searchSource).mockResolvedValue({ sourceKey: 'a', ok: true,
      list: [result({ vodId: 'search-adult', typeName: '电影 / 情色' }), result({ year: undefined })] });
    vi.mocked(detailSite).mockResolvedValue({ episodes: [], videoInfo: { title: '老男孩', year: '2003', typeName: '情色', sourceKey: 'a', sourceName: 'A' } });
    expect((await matchWorkSources(work, [source], true, signal())).items).toEqual([]);
    expect(detailSite).toHaveBeenCalledTimes(1);
    expect((await matchWorkSources(work, [source], false, signal())).items).toHaveLength(2);
  });
  it('bounds concurrency and stops queued work when cancelled', async () => {
    let active = 0, max = 0;
    vi.mocked(searchSource).mockImplementation(async s => { active++; max = Math.max(max, active);
      await new Promise(resolve => setTimeout(resolve, 1)); active--;
      return { sourceKey: s.key, ok: true, list: [] }; });
    const list = Array.from({ length: 6 }, (_, i) => ({ ...source, key: String(i), url: `https://source${i}.example/` }));
    await matchWorkSources(work, list, true, signal());
    expect(max).toBe(3);
    const controller = new AbortController(); controller.abort();
    vi.mocked(searchSource).mockClear();
    await expect(matchWorkSources(work, list, true, controller.signal)).rejects.toThrow();
    expect(searchSource).not.toHaveBeenCalled();
  });
  it('keeps verified detail posters and sanitized credits/introduction instead of discarding them', async () => {
    vi.mocked(searchSource).mockResolvedValue({ sourceKey: 'a', ok: true, list: [result({ year: undefined, pic: '/old.jpg' })] });
    vi.mocked(detailSite).mockResolvedValue({ episodes: [], videoInfo: { title: '老男孩', year: '2003', typeName: '剧情 / 惊悚', cover: '/cover.jpg',
      director: '<b>朴赞郁</b>', actor: '崔岷植 / 刘智泰', area: '韩国', desc: '<p>第一段<br>第二段</p><script>bad()</script>', sourceKey: 'a', sourceName: 'A' } });
    const data = await matchWorkSources(work, [source], true, signal());
    expect(data.items[0]).toMatchObject({ pic: 'https://a.example/old.jpg', metadata: { poster: 'https://a.example/cover.jpg', director: '朴赞郁',
      cast: '崔岷植 / 刘智泰', area: '韩国', intro: '第一段 第二段' } });
  });
  it('uses at most one optional metadata lookup per source while retaining other confirmed editions', async () => {
    vi.mocked(searchSource).mockResolvedValue({ sourceKey: 'a', ok: true, list: [result(), result({ vodId: 'other-edition' })] });
    vi.mocked(detailSite).mockResolvedValue({ episodes: [], videoInfo: { title: '老男孩', year: '2003', cover: 'https://images.example/a.jpg', sourceKey: 'a', sourceName: 'A' } });
    const data = await matchWorkSources(work, [source], true, signal(), true);
    expect(data.items).toHaveLength(2); expect(detailSite).toHaveBeenCalledTimes(1);
    expect(data.items[0].metadata?.poster).toBe('https://images.example/a.jpg');
  });
  it('retains a known search match when optional enrichment fails, without caching incomplete metadata', async () => {
    vi.mocked(detailSite).mockRejectedValue(new Error('timeout'));
    const data = await matchWorkSources(work, [source], true, signal(), true);
    expect(data.items).toHaveLength(1); expect(data.failures).toHaveLength(1); expect(setCache).not.toHaveBeenCalled();
  });
  it('rejects a wrong remake or adult detail before borrowing its metadata', async () => {
    for (const details of [{ year: '2013' }, { typeName: '韩剧' }, { typeName: '情色' }]) {
      vi.mocked(detailSite).mockResolvedValue({ episodes: [], videoInfo: { title: '老男孩', year: '2003', cover: 'https://wrong.example/a.jpg', ...details, sourceKey: 'a', sourceName: 'A' } });
      expect((await matchWorkSources(work, [source], true, signal(), true)).items).toEqual([]);
    }
  });
});

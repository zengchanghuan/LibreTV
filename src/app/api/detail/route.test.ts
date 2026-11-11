import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
import { signSession, SESSION_COOKIE } from '@/lib/auth';
import { fetchUpstream, getCache, setCache } from '@/lib/fetch-utils';
import { checkUpstreamAllowed } from '@/lib/ssrf';
import { detailSite, siteAdapterFor } from '@/lib/site-adapters/site-adapters';
vi.mock('@/lib/fetch-utils', () => ({ fetchUpstream: vi.fn(), getCache: vi.fn(), setCache: vi.fn() }));
vi.mock('@/lib/ssrf', () => ({ checkUpstreamAllowed: vi.fn() }));
vi.mock('@/lib/site-adapters/site-adapters', () => ({ detailSite: vi.fn(), siteAdapterFor: vi.fn() }));
const source = { key: 'test', name: '测试源', url: 'https://media.example/api' };
const episodes = ['https://media.example/movie.m3u8'];
const request = () => new Request(`https://app.example/api/detail?${new URLSearchParams({ id: '1', source: JSON.stringify(source) })}`, { headers: { cookie: `${SESSION_COOKIE}=${signSession().token}` } });
beforeEach(() => {
  vi.resetAllMocks();
  process.env.PASSWORD = 'detail-test-only';
  vi.mocked(checkUpstreamAllowed).mockResolvedValue({ ok: true });
});
describe('detail API metadata enrichment', () => {
  it.each(['cms', 'site'])('includes ratings in the %s response and cache without extra network calls', async path => {
    if (path === 'site') {
      vi.mocked(siteAdapterFor).mockReturnValue('4kvm');
      vi.mocked(detailSite).mockResolvedValue({ episodes, videoInfo: { title: '逆權司機', year: '2017', director: '张勋', sourceKey: 'test', sourceName: '测试源' } });
    } else {
      vi.mocked(fetchUpstream).mockResolvedValue(Response.json({ list: [{ vod_name: '出租车司机', vod_year: '2017', type_name: '剧情片', vod_play_url: `正片$${episodes[0]}` }] }));
    }
    const response = await GET(request());
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.episodes).toEqual(episodes);
    expect(data.videoInfo.rating).toEqual({ source: 'IMDb', value: '7.9', url: 'https://www.imdb.com/title/tt6878038/' });
    expect(setCache).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ videoInfo: expect.objectContaining({ originalTitle: '택시운전사' }) }), 60000);
    expect(fetchUpstream).toHaveBeenCalledTimes(path === 'cms' ? 1 : 0);
    vi.mocked(getCache).mockReturnValue(data);
    expect(await (await GET(request())).json()).toEqual(data);
  });
});

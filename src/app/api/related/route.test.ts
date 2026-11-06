import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
import { signSession, SESSION_COOKIE } from '@/lib/auth';
import { fetchUpstream, getCache, setCache } from '@/lib/fetch-utils';
import { checkUpstreamAllowed } from '@/lib/ssrf';
import { siteAdapterFor } from '@/lib/site-adapters/site-adapters';
import { relatedSite } from '@/lib/site-adapters/site-related';

vi.mock('@/lib/fetch-utils', () => ({ fetchUpstream: vi.fn(), getCache: vi.fn(), setCache: vi.fn() }));
vi.mock('@/lib/ssrf', () => ({ checkUpstreamAllowed: vi.fn() }));
vi.mock('@/lib/site-adapters/site-adapters', () => ({ siteAdapterFor: vi.fn() }));
vi.mock('@/lib/site-adapters/site-related', () => ({ relatedSite: vi.fn() }));

const source = { key: 'custom_1', name: '测试源', url: 'https://media.example/api?token=public' };
const seed = { vod_id: 1, vod_name: '流浪地球', type_id: 6, type_name: '科幻片', vod_year: '2019' };
const sequel = { ...seed, vod_id: 2, vod_name: '流浪地球2', vod_year: '2023' };
function request(extra: Record<string, string> = {}, authenticated = true) {
  const query = new URLSearchParams({ id: '1', source: JSON.stringify(source), ...extra });
  return new Request(`https://app.example/api/related?${query}`, {
    headers: authenticated ? { cookie: `${SESSION_COOKIE}=${signSession().token}` } : {},
  });
}
beforeEach(() => {
  process.env.PASSWORD = 'related-test-only';
  vi.resetAllMocks();
  vi.mocked(checkUpstreamAllowed).mockResolvedValue({ ok: true });
  vi.mocked(fetchUpstream).mockImplementation(async (url) =>
    Response.json({ list: new URL(url).searchParams.has('ids') ? [seed] : [seed, sequel] }));
});

describe('related API', () => {
  it('requires authentication before requesting upstream', async () => {
    expect((await GET(request({}, false))).status).toBe(401);
    expect(fetchUpstream).not.toHaveBeenCalled();
  });
  it('rejects malformed identities/config and private upstreams', async () => {
    const invalid: Record<string, string>[] = [{ id: '../1' }, { source: 'null' }, { source: '{' }, { source: JSON.stringify({ ...source, url: 123 }) }];
    for (const extra of invalid) {
      expect((await GET(request(extra))).status).toBe(400);
    }
    vi.mocked(checkUpstreamAllowed).mockResolvedValue({ ok: false, reason: '内网地址' });
    expect((await GET(request())).status).toBe(400);
    expect(fetchUpstream).not.toHaveBeenCalled();
  });
  it('delegates website recommendations after URL validation, without CMS requests', async () => {
    vi.mocked(siteAdapterFor).mockReturnValue('4kvm');
    vi.mocked(relatedSite).mockResolvedValue({ items: [] });
    expect(await (await GET(request())).json()).toEqual({ items: [] });
    expect(relatedSite).toHaveBeenCalledWith({ ...source, isAdult: false }, '1', true, expect.any(AbortSignal));
    expect(fetchUpstream).not.toHaveBeenCalled();
    expect(setCache).toHaveBeenCalled();
    vi.mocked(checkUpstreamAllowed).mockResolvedValue({ ok: false, reason: '内网地址' });
    vi.mocked(relatedSite).mockClear();
    expect((await GET(request())).status).toBe(400);
    expect(relatedSite).not.toHaveBeenCalled();
  });
  it('preserves website partial failures for retry and rejects total failures', async () => {
    vi.mocked(siteAdapterFor).mockReturnValue('baipiaozhe');
    vi.mocked(relatedSite).mockResolvedValue({ items: [], partial: true });
    expect(await (await GET(request({ id: 'a'.repeat(120) }))).json()).toEqual({ items: [], partial: true });
    expect(setCache).not.toHaveBeenCalled();
    vi.mocked(relatedSite).mockRejectedValue(new Error('timeout'));
    expect((await GET(request())).status).toBe(502);
  });
  it('returns ranked deduplicated cards, bounded requests, safe fetch and five minute cache', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const data = await response.json();
    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toMatchObject({ vodId: '2', name: '流浪地球2', sourceKey: source.key, sourceUrl: source.url });
    expect(fetchUpstream).toHaveBeenCalledTimes(4);
    for (const [url, options] of vi.mocked(fetchUpstream).mock.calls) {
      expect(new URL(url).searchParams.get('token')).toBe('public');
      expect(options).toMatchObject({ signal: expect.any(AbortSignal), timeoutMs: 6000 });
      expect(options?.safeRedirects).not.toBe(false);
    }
    expect(setCache).toHaveBeenCalledWith(expect.any(String), data, 300_000);
  });
  it('keeps partial successes retryable without caching incomplete results', async () => {
    vi.mocked(fetchUpstream).mockImplementation(async (url) => {
      const params = new URL(url).searchParams;
      if (params.get('pg') === '2') throw new Error('timeout');
      return Response.json({ list: params.has('ids') ? [seed] : [sequel] });
    });
    const data = await (await GET(request())).json();
    expect(data.partial).toBe(true);
    expect(data.items).toHaveLength(1);
    expect(setCache).not.toHaveBeenCalled();
  });
  it('distinguishes total upstream failure from a successful empty result', async () => {
    vi.mocked(fetchUpstream).mockResolvedValue(Response.json({ list: [] }));
    expect((await GET(request())).status).toBe(404);
    vi.mocked(fetchUpstream).mockRejectedValue(new Error('timeout'));
    expect((await GET(request())).status).toBe(502);
    vi.mocked(fetchUpstream).mockImplementation(async (url) => {
      if (!new URL(url).searchParams.has('ids')) throw new Error('timeout');
      return Response.json({ list: [seed] });
    });
    expect((await GET(request())).status).toBe(502);
  });
  it('does not request adult sources when filtering is enabled', async () => {
    expect(await (await GET(request({ source: JSON.stringify({ ...source, isAdult: true }) }))).json()).toEqual({ items: [] });
    expect(fetchUpstream).not.toHaveBeenCalled();
  });
  it('uses cached results without upstream requests and separates source/filter identities', async () => {
    vi.mocked(getCache).mockReturnValue({ items: [] });
    await GET(request());
    await GET(request({ filterAdult: 'false' }));
    await GET(request({ source: JSON.stringify({ ...source, key: 'another' }) }));
    expect(new Set(vi.mocked(getCache).mock.calls.map(([key]) => key)).size).toBe(3);
    expect(fetchUpstream).not.toHaveBeenCalled();
  });
});

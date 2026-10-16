import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
import { signSession, SESSION_COOKIE } from '@/lib/auth';
import { getResourcePage, HDResourceUnavailableError } from '@/lib/hd-resource-catalog';
vi.mock('@/lib/hd-resource-catalog', async importOriginal => ({ ...await importOriginal<object>(), getResourcePage: vi.fn() }));
beforeEach(() => { process.env.PASSWORD = 'hd-test-only'; vi.mocked(getResourcePage).mockReset(); });
function request(query: string, authenticated = true) {
  return new Request(`https://app.example/api/hd-resources?${query}`, { headers: authenticated ? { cookie: `${SESSION_COOKIE}=${signSession().token}` } : {} });
}
describe('HD resource API', () => {
  it('requires login before any upstream request', async () => {
    expect((await GET(request('site=rrdynb', false))).status).toBe(401);
    expect(getResourcePage).not.toHaveBeenCalled();
  });
  it('rejects other sources, invalid modes and unapproved URLs', async () => {
    for (const query of ['site=sina', 'site=rrdynb&mode=play', 'site=rrdynb&url=https://localhost/', 'site=rrdynb&mode=detail']) expect((await GET(request(query))).status).toBe(400);
    expect(getResourcePage).not.toHaveBeenCalled();
  });
  it('returns source failure without substituting ordinary recommendations', async () => {
    vi.mocked(getResourcePage).mockRejectedValue(new Error('源站连接失败'));
    const response = await GET(request('site=rrdynb'));
    expect(response.status).toBe(502); expect(await response.json()).toEqual({ error: '源站连接失败' });
  });
  it('serves catalog and detail with no shared HTTP cache', async () => {
    vi.mocked(getResourcePage).mockResolvedValue({ items: [], fetchedAt: 'now' });
    const response = await GET(request('site=rrdynb'));
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(getResourcePage).toHaveBeenCalledWith('rrdynb', 'https://www.rrdynb.com/', false, expect.any(AbortSignal));
  });
  it('preserves the closed-site status so clients offer a recovery check instead of a generic network error', async () => {
    vi.mocked(getResourcePage).mockRejectedValue(new HDResourceUnavailableError('原站已关停', 410));
    const response = await GET(request('site=rrdynb'));
    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({ error: '原站已关停' });
  });

  it('rejects removed sources including stale detail links without requesting upstream', async () => {
    for (const query of ['site=yinfans', 'site=1lou', 'site=yinfans&mode=detail&url=https://www.yinfans.me/movie/17742', 'site=1lou&mode=detail&url=https://www.1lou.me/thread-123.htm']) {
      expect((await GET(request(query))).status).toBe(400);
    }
    expect(getResourcePage).not.toHaveBeenCalled();
  });

});

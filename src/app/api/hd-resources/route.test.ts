import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
import { signSession, SESSION_COOKIE } from '@/lib/auth';
import { getResourcePage } from '@/lib/hd-resource-catalog';
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
    const response = await GET(request('site=yinfans'));
    expect(response.status).toBe(502); expect(await response.json()).toEqual({ error: '源站连接失败' });
  });
  it('serves catalog and detail with no shared HTTP cache', async () => {
    vi.mocked(getResourcePage).mockResolvedValue({ items: [], fetchedAt: 'now' });
    const response = await GET(request('site=rrdynb'));
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(getResourcePage).toHaveBeenCalledWith('rrdynb', 'https://www.rrdynb.com/', false, expect.any(AbortSignal));
  });
});

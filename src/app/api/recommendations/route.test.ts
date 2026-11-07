import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import { signSession, SESSION_COOKIE } from '@/lib/auth';
import { deepSeekConfigured, deepSeekRecommendations } from '@/lib/deepseek-recommendations';

vi.mock('@/lib/deepseek-recommendations', () => ({ deepSeekConfigured: vi.fn(), deepSeekRecommendations: vi.fn() }));
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('PASSWORD', 'recommendation-test-only'); });
afterEach(() => vi.unstubAllEnvs());
const seed = { title: '亲切的金子', year: '2005', typeName: '电影' };
const request = (body: unknown = { seed }, authenticated = true) => new Request('https://app.example/api/recommendations', {
  method: 'POST', body: JSON.stringify(body), headers: authenticated ? { cookie: `${SESSION_COOKIE}=${signSession().token}` } : {},
});
describe('work recommendations API', () => {
  it('requires authentication before paid calls and rejects malformed inputs', async () => {
    expect((await POST(request({ seed }, false))).status).toBe(401);
    for (const value of [null, {}, { seed: null }, { seed: { title: 'x'.repeat(101) } }, { seed: { ...seed, year: 2005 } }]) {
      expect((await POST(request(value))).status).toBe(400);
    }
    expect(deepSeekRecommendations).not.toHaveBeenCalled();
  });
  it('returns content-first local recommendations without requiring external credentials', async () => {
    const res = await POST(request());
    const data = await res.json();
    expect(data.provider).toBe('local');
    expect(data.items.slice(0, 2).map((i: { title: string }) => i.title)).toEqual(['老男孩', '我要复仇']);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(deepSeekRecommendations).not.toHaveBeenCalled();
  });
  it('keeps useful local results and a retry state when DeepSeek fails', async () => {
    vi.mocked(deepSeekConfigured).mockReturnValue(true);
    vi.mocked(deepSeekRecommendations).mockRejectedValue(new Error('timeout'));
    const data = await (await POST(request())).json();
    expect(data.partial).toBe(true); expect(data.items.length).toBeGreaterThan(0);
  });
  it('serves local cards before starting a slow provider, and avoids paid guessing without a year', async () => {
    vi.mocked(deepSeekConfigured).mockReturnValue(true);
    expect((await (await POST(request({ seed, mode: 'local' }))).json()).aiAvailable).toBe(true);
    expect(deepSeekRecommendations).not.toHaveBeenCalled();
    expect((await (await POST(request({ seed: { title: '不明确的同名作品' } }))).json()).aiAvailable).toBe(false);
    expect(deepSeekRecommendations).not.toHaveBeenCalled();
  });
});

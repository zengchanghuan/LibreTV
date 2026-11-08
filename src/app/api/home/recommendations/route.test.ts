import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { after } from 'next/server';
import { GET } from './route';
import { SESSION_COOKIE, signSession } from '@/lib/auth';
import { readHomeRecommendations, warmHomeRecommendations } from '@/lib/home-recommendation-service';
import type { HomeRecommendations } from '@/lib/home-discovery-types';

vi.mock('next/server', async importOriginal => ({ ...await importOriginal<typeof import('next/server')>(), after: vi.fn() }));
vi.mock('@/lib/home-recommendation-service', () => ({ readHomeRecommendations: vi.fn(), warmHomeRecommendations: vi.fn() }));
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('PASSWORD', 'home-route-test'); });
afterEach(() => vi.unstubAllEnvs());
const request = (query = '', auth = true) => new Request(`https://app.example/api/home/recommendations${query}`, { headers: auth ? { cookie: `${SESSION_COOKIE}=${signSession().token}` } : {} });
describe('homepage API', () => {
  it('authenticates and validates before reading cache or scheduling paid work', async () => {
    expect((await GET(request('', false))).status).toBe(401);
    expect((await GET(request('?filterAdult=invalid'))).status).toBe(400);
    expect(readHomeRecommendations).not.toHaveBeenCalled(); expect(after).not.toHaveBeenCalled();
  });
  it('responds with local data and defers generation until after the response', async () => {
    vi.mocked(readHomeRecommendations).mockResolvedValue({ aiStatus: 'pending', batches: [] } as unknown as HomeRecommendations);
    const result = await GET(request());
    expect(result.headers.get('cache-control')).toBe('private, no-store');
    expect(await result.json()).toMatchObject({ aiStatus: 'pending' });
    expect(readHomeRecommendations).toHaveBeenCalledWith(true);
    expect(warmHomeRecommendations).not.toHaveBeenCalled();
    const callback = vi.mocked(after).mock.calls[0][0] as () => Promise<void>;
    await callback(); expect(warmHomeRecommendations).toHaveBeenCalledWith(true);
  });
  it('does not schedule more paid calls for a completed daily list', async () => {
    vi.mocked(readHomeRecommendations).mockResolvedValue({ aiStatus: 'ready' } as HomeRecommendations);
    await GET(request('?filterAdult=false'));
    expect(readHomeRecommendations).toHaveBeenCalledWith(false);
    expect(after).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { after } from 'next/server';
import { GET } from './route';
import { SESSION_COOKIE, signSession } from '@/lib/auth';
import { readHomeRecommendations, warmHomeRecommendations } from '@/lib/home-recommendation-service';
import type { HomeRecommendations } from '@/lib/home-discovery-types';
import { readHomeFeedback } from '@/lib/home-feedback';
import { recommendationCatalog } from '@/lib/recommendation-catalog';

vi.mock('next/server', async importOriginal => ({ ...await importOriginal<typeof import('next/server')>(), after: vi.fn() }));
vi.mock('@/lib/home-recommendation-service', () => ({ readHomeRecommendations: vi.fn(), warmHomeRecommendations: vi.fn() }));
vi.mock('@/lib/home-feedback', () => ({ readHomeFeedback: vi.fn() }));
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('PASSWORD', 'home-route-test'); vi.mocked(readHomeFeedback).mockResolvedValue([]); });
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
  it('excludes this account’s dislikes without mutating the shared daily response', async () => {
    const work = recommendationCatalog.find(item => item.title === '精武英雄')!;
    const shared = { aiStatus: 'ready', batches: [[work]] } as HomeRecommendations;
    vi.mocked(readHomeRecommendations).mockResolvedValue(shared);
    vi.mocked(readHomeFeedback).mockResolvedValue([{ workId: work.id, work, vote: 'dislike', updatedAt: Date.now() }]);
    const result = await (await GET(request())).json() as HomeRecommendations;
    expect(result.batches.flat().map(item => item.id)).not.toContain(work.id);
    expect(shared.batches).toEqual([[work]]);
    expect(readHomeFeedback).toHaveBeenCalledWith(null);
  });
  it('does not silently show disliked films when preference storage fails', async () => {
    vi.mocked(readHomeRecommendations).mockResolvedValue({ aiStatus: 'ready', batches: [] } as unknown as HomeRecommendations);
    vi.mocked(readHomeFeedback).mockRejectedValue(new Error('disk unavailable'));
    expect((await GET(request())).status).toBe(503);
  });
});

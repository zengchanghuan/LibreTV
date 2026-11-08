import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('./deepseek-recommendations', () => ({ deepSeekConfigured: vi.fn(), deepSeekRecommendations: vi.fn() }));
let dir: string;
beforeEach(async () => {
  vi.resetModules(); vi.resetAllMocks();
  dir = await mkdtemp(join(tmpdir(), 'home-recommend-test-'));
  vi.stubEnv('HOME_RECOMMEND_CACHE_DIR', dir);
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }); });

describe('home recommendation background jobs', () => {
  it('serves local results immediately, shares one background job and restores its daily disk cache', async () => {
    const ai = await import('./deepseek-recommendations');
    vi.mocked(ai.deepSeekConfigured).mockReturnValue(true);
    const { recommendationCatalog } = await import('./recommendation-catalog');
    const known = recommendationCatalog.find(w => w.title === '精武英雄')!;
    let complete!: () => void;
    const gate = new Promise<void>(resolve => { complete = resolve; });
    vi.mocked(ai.deepSeekRecommendations).mockImplementation(async () => { await gate; return [{ ...known, aiReason: '关联推荐', origin: 'ai' }]; });
    const service = await import('./home-recommendation-service');
    const first = await service.readHomeRecommendations(true);
    expect(first.aiStatus).toBe('pending'); expect(first.batches[0]).toHaveLength(12);
    const tasks = Array.from({ length: 10 }, () => service.warmHomeRecommendations(true));
    await vi.waitFor(() => expect(ai.deepSeekRecommendations).toHaveBeenCalledTimes(1));
    expect((await service.readHomeRecommendations(true)).batches).toEqual(first.batches);
    complete(); await Promise.all(tasks);
    expect(ai.deepSeekRecommendations).toHaveBeenCalledTimes(3);
    const result = await service.readHomeRecommendations(true);
    expect(result.aiStatus).toBe('ready'); expect(result.batches[0][0].origin).toBe('ai');
    vi.resetModules();
    const restored = await import('./home-recommendation-service');
    expect((await restored.readHomeRecommendations(true)).batches).toEqual(result.batches);
    await restored.warmHomeRecommendations(true);
    expect(ai.deepSeekRecommendations).toHaveBeenCalledTimes(3);
  });
  it('falls back after provider failures, bounds retries and isolates filter variants', async () => {
    const ai = await import('./deepseek-recommendations');
    vi.mocked(ai.deepSeekConfigured).mockReturnValue(true);
    vi.mocked(ai.deepSeekRecommendations).mockRejectedValue(new Error('upstream unavailable'));
    const service = await import('./home-recommendation-service');
    await service.warmHomeRecommendations(true);
    expect((await service.readHomeRecommendations(true)).aiStatus).toBe('fallback');
    await service.warmHomeRecommendations(true);
    expect(ai.deepSeekRecommendations).toHaveBeenCalledTimes(3);
    expect((await service.readHomeRecommendations(false)).aiStatus).toBe('pending');
    await service.warmHomeRecommendations(true, Date.now() + 360000);
    await service.warmHomeRecommendations(true, Date.now() + 720000);
    expect(ai.deepSeekRecommendations).toHaveBeenCalledTimes(6);
  });
  it('does not call AI when no key is configured', async () => {
    const ai = await import('./deepseek-recommendations');
    vi.mocked(ai.deepSeekConfigured).mockReturnValue(false);
    const service = await import('./home-recommendation-service');
    expect((await service.readHomeRecommendations(true)).aiStatus).toBe('disabled');
    await service.warmHomeRecommendations(true);
    expect(ai.deepSeekRecommendations).not.toHaveBeenCalled();
  });
});

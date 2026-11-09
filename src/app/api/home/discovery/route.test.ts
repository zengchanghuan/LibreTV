import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
import { signSession, SESSION_COOKIE } from '@/lib/auth';
import { readDiscovery } from '@/lib/discovery-service';
import { readHomeFeedback } from '@/lib/home-feedback';
import { discoveryStarters } from '@/lib/discovery-starters';
vi.mock('@/lib/home-feedback', () => ({ readHomeFeedback: vi.fn() }));
vi.mock('next/server', async original => ({ ...await original<typeof import('next/server')>(), after: vi.fn() }));
vi.mock('@/lib/discovery-service', () => ({ readDiscovery: vi.fn(), refreshDiscovery: vi.fn() }));
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('PASSWORD', 'discovery-test-only'); vi.mocked(readHomeFeedback).mockResolvedValue([]); vi.mocked(readDiscovery).mockResolvedValue({ recent: { new: [], series: [], added: [] }, refreshedAt: null, stale: false, partial: false, loading: false, popular: [], popularStatus: 'collecting', editorial: [], enabled: { recent: true, popular: true, editorial: true } }); });
afterEach(() => vi.unstubAllEnvs());
describe('discovery endpoint', () => {
  it('guards data and forwards only bounded source keys', async () => {
    expect((await GET(new Request('https://app.example/api/home/discovery'))).status).toBe(401);
    const res = await GET(new Request('https://app.example/api/home/discovery?sources=env_0,env_2', { headers: { cookie: `${SESSION_COOKIE}=${signSession().token}` } }));
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(readDiscovery).toHaveBeenCalledWith(['env_0', 'env_2'], expect.any(Number), []);
    expect(readHomeFeedback).toHaveBeenCalledWith(null);
  });
  it('passes the signed-in account preferences into candidate selection and fails closed on storage errors', async () => {
    const preferences = [{ workId: 'a', work: discoveryStarters[0], vote: 'dislike' as const, updatedAt: 1 }];
    vi.mocked(readHomeFeedback).mockResolvedValue(preferences);
    const request = () => new Request('https://app.example/api/home/discovery', { headers: { cookie: `${SESSION_COOKIE}=${signSession().token}` } });
    expect((await GET(request())).status).toBe(200);
    expect(readDiscovery).toHaveBeenCalledWith([''], expect.any(Number), preferences);
    vi.mocked(readHomeFeedback).mockRejectedValue(new Error('storage error'));
    expect((await GET(request())).status).toBe(503);
  });
});

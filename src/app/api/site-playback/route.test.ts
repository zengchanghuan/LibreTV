import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
import { SESSION_COOKIE, signSession } from '@/lib/auth';
vi.mock('@/lib/site-adapters/site-adapters', async importOriginal => ({ ...(await importOriginal<object>()), resolveSitePlayback: vi.fn(async () => ({ url: 'https://media.example.com/movie.mp4', type: 'mp4' })) }));
beforeAll(() => { process.env.PASSWORD = 'test-only'; });
afterEach(() => { vi.clearAllMocks(); });
function req(query: string, authenticated = true) { return new Request(`https://local.test/api/site-playback?${query}`, { headers: authenticated ? { cookie: `${SESSION_COOKIE}=${signSession().token}` } : {} }); }
describe('site playback route', () => {
  it('requires the same session as search and detail', async () => expect((await GET(req('site=4kvm&id=abc', false))).status).toBe(401));
  it('rejects arbitrary providers and traversal IDs', async () => {
    for (const q of ['site=http://127.0.0.1&id=x', 'site=4kvm&id=../secret', 'site=baipiaozhe&id=']) expect((await GET(req(q))).status).toBe(400);
  });
  it('returns a short-lived media response without cacheable tokens', async () => {
    const response = await GET(req('site=4kvm&id=abc'));
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ url:'https://media.example.com/movie.mp4',type:'mp4' });
  });
});

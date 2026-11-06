import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchUpstream } from '@/lib/fetch-utils';
import { checkUpstreamAllowed } from '@/lib/ssrf';

vi.mock('@/lib/fetch-utils', () => ({ fetchUpstream: vi.fn(), getCache: vi.fn(), setCache: vi.fn() }));
vi.mock('@/lib/ssrf', () => ({ checkUpstreamAllowed: vi.fn(async () => ({ ok: true })) }));
const source = { key: 'bp', name: '白嫖者', url: 'https://baipiaozhe.ai' };
const seed = { id: 'seed', title: '流浪地球', content_kind: 'movie', genres: ['科幻'], directors: ['郭帆'], actors: ['吴京'] };
const sequel = { ...seed, id: 'sequel', title: '流浪地球2' };
function setupFetch(browse: (url: URL) => Response | Promise<Response>) {
  vi.mocked(fetchUpstream).mockImplementation(async (url) => {
    const target = new URL(url);
    if (target.pathname === '/') return new Response('<script src="/assets/movie-card-runtime-test.js"></script>');
    if (target.pathname.startsWith('/assets/')) return new Response(`const key="${'a'.repeat(64)}".trim()`);
    if (target.pathname === '/v1/users/anonymous') return new Response('{}', { headers: { 'set-cookie': 'visitor=test; Path=/; HttpOnly' } });
    if (target.pathname === '/v1/catalog/seed') return Response.json(seed);
    return browse(target);
  });
}
beforeEach(() => {
  vi.resetAllMocks(); vi.resetModules();
  vi.mocked(checkUpstreamAllowed).mockResolvedValue({ ok: true });
  vi.stubEnv('BAIPIAOZHE_ANONYMOUS_ID', 'web_related-unit-test-identity');
});
afterEach(() => vi.unstubAllEnvs());

describe('BP related catalog requests', () => {
  it('queries bounded genre and series results with the same guest session and ranks metadata', async () => {
    setupFetch(() => Response.json({ cards: [seed, sequel, { ...sequel, id: 'adult', is_adult: true }] }));
    const { bpRelated } = await import('./baipiaozhe');
    const result = await bpRelated(source, 'seed', true, new AbortController().signal);
    expect(result.items.map(item => item.vodId)).toEqual(['sequel']);
    expect(result.items[0].reasons).toContain('同导演 · 郭帆');
    expect(result.partial).toBe(false);
    const calls = vi.mocked(fetchUpstream).mock.calls;
    const browse = calls.filter(([url]) => new URL(url).pathname === '/v1/browse/catalog');
    expect(browse).toHaveLength(2);
    expect(new URL(browse[0][0]).searchParams.get('genre')).toBe('科幻');
    expect(new URL(browse[0][0]).searchParams.get('kind')).toBe('movie');
    expect(new URL(browse[1][0]).searchParams.get('q')).toBe('流浪地球');
    for (const [, options] of browse) expect(options).toMatchObject({ redirect: 'error', signal: expect.any(AbortSignal), headers: { Cookie: 'visitor=test' } });
    expect(calls.filter(([url]) => url.endsWith('/v1/users/anonymous'))).toHaveLength(1);
  });
  it('keeps a working query on partial failure and surfaces total failure', async () => {
    setupFetch(url => url.searchParams.has('q') ? Response.json({ cards: [sequel] }) : new Response('', { status: 503 }));
    const { bpRelated } = await import('./baipiaozhe');
    const result = await bpRelated(source, 'seed', true, new AbortController().signal);
    expect(result.partial).toBe(true); expect(result.items).toHaveLength(1);
    setupFetch(() => new Response('', { status: 503 }));
    await expect(bpRelated(source, 'seed', true, new AbortController().signal)).rejects.toThrow('推荐加载失败');
  });
  it('cancels promptly while shared session initialization is still pending', async () => {
    vi.mocked(fetchUpstream).mockImplementation(() => new Promise(() => {}));
    const { bpRelated } = await import('./baipiaozhe');
    const controller = new AbortController();
    const pending = bpRelated(source, 'seed', true, controller.signal);
    controller.abort(new Error('cancelled'));
    await expect(pending).rejects.toThrow('cancelled');
    expect(fetchUpstream).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { pwaWorker } from './pwa-worker';

function worker(fetch = vi.fn()) {
  const handlers: Record<string, (event: unknown) => void> = {};
  const skipWaiting = vi.fn();
  const offline = new Response('offline');
  const cache = { match: vi.fn().mockResolvedValue(offline), add: vi.fn().mockResolvedValue(undefined) };
  const caches = { open: vi.fn().mockResolvedValue(cache), keys: vi.fn().mockResolvedValue(['libretv-offline-old', 'libretv-offline-test', 'libretv-video-cache']), delete: vi.fn() };
  runInNewContext(pwaWorker('test'), { self: { addEventListener: (name: string, handler: (event: unknown) => void) => handlers[name] = handler, location: { origin: 'https://tv.test' }, skipWaiting, clients: { claim: vi.fn() } }, caches, fetch, URL, Response });
  return { handlers, skipWaiting, caches, cache, fetch };
}
describe('PWA cache isolation', () => {
  it('never intercepts login, member history, RSC, proxy or range media requests', () => {
    const { handlers, fetch } = worker();
    for (const [path, mode, method] of [['/api/auth', 'navigate', 'GET'], ['/api/family/sync', 'cors', 'POST'], ['/api/proxy?url=video', 'navigate', 'GET'], ['/watch?_rsc=123', 'cors', 'GET'], ['/video.mp4', 'cors', 'GET']]) {
      const respondWith = vi.fn();
      handlers.fetch({ request: { url: `https://tv.test${path}`, mode, method }, respondWith });
      expect(respondWith).not.toHaveBeenCalled();
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it('serves offline fallback only when document navigation fails', async () => {
    const { handlers } = worker(vi.fn().mockRejectedValue(new Error('offline')));
    let result: Promise<Response> | undefined;
    handlers.fetch({ request: { url: 'https://tv.test/watch?id=42', mode: 'navigate', method: 'GET' }, respondWith: (value: Promise<Response>) => result = value });
    expect(await (await result)?.text()).toBe('offline');
  });
  it('does not activate updates without a user request or delete video caches', async () => {
    const { handlers, skipWaiting, caches } = worker();
    let done: Promise<void> | undefined;
    handlers.install({ waitUntil: (value: Promise<void>) => done = value }); await done;
    expect(skipWaiting).not.toHaveBeenCalled();
    handlers.message({ data: { type: 'ACTIVATE_UPDATE' } }); expect(skipWaiting).toHaveBeenCalledOnce();
    handlers.activate({ waitUntil: (value: Promise<void>) => done = value }); await done;
    expect(caches.delete.mock.calls).toEqual([['libretv-offline-old']]);
  });
});

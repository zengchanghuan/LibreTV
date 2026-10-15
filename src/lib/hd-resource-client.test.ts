import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, onUnauthorized } from './client-api';
afterEach(() => vi.unstubAllGlobals());
describe('HD catalog authentication recovery', () => {
  it.each(['catalog', 'detail'])('opens global login on an expired %s request and supports retry after login', async mode => {
    const events = new EventTarget();
    vi.stubGlobal('window', events);
    const handler = vi.fn(); const remove = onUnauthorized(handler);
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 401 })).mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal('fetch', fetcher);
    const request = () => mode === 'catalog' ? api.hdCatalog('rrdynb', 'https://www.rrdynb.com/') : api.hdResourceDetail('rrdynb', 'https://www.rrdynb.com/plus/view.php?aid=1');
    await expect(request()).rejects.toMatchObject({ status: 401 });
    expect(handler).toHaveBeenCalledOnce();
    await expect(request()).resolves.toEqual({ ok: true });
    remove();
  });
});

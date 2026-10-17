import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleProxyRequest } from './proxy-handlers';

vi.mock('./api-guard', () => ({ guardRequest: () => null, jsonError: vi.fn() }));
vi.mock('./ssrf', () => ({
  isValidProxyUrl: () => true, isBlockedByDNS: async () => false,
  checkUpstreamAllowed: async () => ({ ok: true }), checkLiveUrlAllowed: async () => ({ ok: true }),
}));
beforeEach(() => {
  // Node's native AbortSignal.timeout bypasses Vitest's fake clock.
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), ms);
    return controller.signal;
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('media proxy streaming', () => {
  it.each([undefined, 'identity'])('preserves the full TS byte count with encoding %s before the body completes', async encoding => {
    let source!: ReadableStreamDefaultController<Uint8Array>;
    const headers = new Headers({ 'content-type': 'video/mp2t', 'content-length': '4' });
    if (encoding) headers.set('content-encoding', encoding);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { source = controller; },
    }), { headers })));
    const response = await handleProxyRequest(new Request('https://tv.example/api/proxy'), 'https://cdn.example/video.ts');
    expect(response.headers.get('content-length')).toBe('4');
    expect(response.headers.has('content-encoding')).toBe(false);
    const reader = response.body!.getReader();
    source.enqueue(new Uint8Array([1, 2]));
    expect((await reader.read()).value).toEqual(new Uint8Array([1, 2]));
    source.enqueue(new Uint8Array([3, 4])); source.close();
    expect((await reader.read()).value).toEqual(new Uint8Array([3, 4]));
    expect((await reader.read()).done).toBe(true);
  });

  it('does not forward the compressed wire length after fetch decompresses a TS body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4]), {
      headers: { 'content-type': 'video/mp2t', 'content-encoding': 'gzip', 'content-length': '24' },
    })));
    const response = await handleProxyRequest(new Request('https://tv.example/api/proxy'), 'https://cdn.example/video.ts');
    expect(response.headers.has('content-length')).toBe(false);
    expect(response.headers.has('content-encoding')).toBe(false);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('exposes the assembled length, rather than the first range length, for accelerated TS downloads', async () => {
    const bytes = new Uint8Array(700_000);
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const range = new Headers(init.headers).get('range')!;
      const [start, requestedEnd] = range.slice(6).split('-').map(Number);
      const end = Math.min(requestedEnd, bytes.length - 1);
      return new Response(bytes.slice(start, end + 1), { status: 206, headers: {
        'content-type': 'video/mp2t', 'content-range': `bytes ${start}-${end}/${bytes.length}`,
        'content-length': String(end - start + 1), etag: '"stable"',
      } });
    }));
    const response = await handleProxyRequest(new Request('https://tv.example/api/proxy', {
      headers: { 'X-Playback-Priority': 'foreground' },
    }), 'https://cdn.example/video.ts');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe(String(bytes.length));
    expect(response.headers.get('x-playback-ranges')).toBe('3');
    expect(response.headers.has('content-range')).toBe(false);
    expect((await response.arrayBuffer()).byteLength).toBe(bytes.length);
  });

  it('delivers a TS segment taking over 8 seconds, then cancels upstream on seek', async () => {
    vi.useFakeTimers();
    let source!: ReadableStreamDefaultController<Uint8Array>;
    let signal!: AbortSignal;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      signal = init.signal!;
      return new Response(new ReadableStream<Uint8Array>({ start(c) { source = c; } }), {
        headers: { 'content-type': 'video/mp2t' },
      });
    }));
    const response = await handleProxyRequest(new Request('https://tv.example/api/proxy'), 'https://cdn.example/video.ts');
    const reader = response.body!.getReader();
    for (let i = 0; i < 3; i++) {
      const pending = reader.read();
      await vi.advanceTimersByTimeAsync(4000);
      expect(signal.aborted).toBe(false);
      source.enqueue(new Uint8Array([i]));
      expect((await pending).value).toEqual(new Uint8Array([i]));
    }
    await reader.cancel('seek');
    expect(signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns a controlled error for a stalled playlist body', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream(), {
      headers: { 'content-type': 'application/vnd.apple.mpegurl' },
    })));
    const pending = handleProxyRequest(new Request('https://tv.example/api/proxy'), 'https://cdn.example/video.m3u8');
    await vi.advanceTimersByTimeAsync(30001);
    expect((await pending).status).toBe(502);
    expect(vi.getTimerCount()).toBe(0);
  });
});

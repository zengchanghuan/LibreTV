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

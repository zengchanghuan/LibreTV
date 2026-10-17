import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Hls, { type LoaderStats } from 'hls.js';
import { ForegroundPrefetcher } from './foreground-prefetch';
import { createHlsLoader } from './hls-loader';

const mocks = vi.hoisted(() => ({ cache: vi.fn(), network: vi.fn() }));
vi.mock('./video-cache', () => ({ buildSegmentCacheKey: (url: string) => url, readCachedSegment: mocks.cache, touchMeta: vi.fn() }));
const proxy = (name: string) => 'https://tv.example/api/proxy?url=' + encodeURIComponent('https://cdn.example/' + name);
const request = vi.fn<typeof fetch>();
const pipelines: ForegroundPrefetcher[] = [];
const create = () => { const p = new ForegroundPrefetcher(); pipelines.push(p); return p; };
class Loader {
  stats = {} as LoaderStats;
  load = mocks.network;
  abort() {}
  destroy() {}
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('document', { baseURI: 'https://tv.example/watch' });
  vi.stubGlobal('location', { origin: 'https://tv.example' });
  vi.stubGlobal('fetch', request);
  mocks.cache.mockResolvedValue(null);
});
afterEach(() => { pipelines.splice(0).forEach(p => p.clear()); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('foreground one-fragment lookahead', () => {
  it('starts the next download early and HLS consumes it once without another network load', async () => {
    let finish!: () => void;
    request.mockImplementation(async () => new Response(new ReadableStream({ start(output) {
      output.enqueue(new Uint8Array([1, 2]));
      finish = () => { output.enqueue(new Uint8Array([3, 4])); output.close(); };
    } })));
    const pipeline = create();
    pipeline.prepare(proxy('a.ts'), proxy('b.ts'));
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    const config = request.mock.calls[0][1]!;
    expect(config.credentials).toBe('same-origin');
    expect(new Headers(config.headers).get('x-playback-priority')).toBe('foreground');
    const Cached = createHlsLoader(Hls, { networkLoader: Loader, foreground: pipeline });
    const success = vi.fn();
    new Cached({}).load({ url: proxy('b.ts'), frag: {} }, {}, { onSuccess: success });
    await Promise.resolve();
    expect(success).not.toHaveBeenCalled();
    finish();
    await vi.waitFor(() => expect(success).toHaveBeenCalledOnce());
    expect(new Uint8Array(success.mock.calls[0][0].data)).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(success.mock.calls[0][1].loaded).toBe(4);
    expect(success.mock.calls[0][1].loading.end - success.mock.calls[0][1].loading.start).toBeGreaterThan(0);
    expect(mocks.network).not.toHaveBeenCalled();
  });

  it('retains only the consumed and next fragment, then aborts obsolete work on a seek', async () => {
    request.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new DOMException('seek', 'AbortError')), { once: true });
    }));
    const pipeline = create();
    pipeline.prepare(proxy('a.ts'), proxy('b.ts'));
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    const old = pipeline.take(proxy('b.ts'))!;
    pipeline.prepare(proxy('b.ts'), proxy('c.ts'));
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(request.mock.calls[0][1]!.signal!.aborted).toBe(false);
    pipeline.prepare(proxy('x.ts'), proxy('y.ts'));
    expect(request.mock.calls.slice(0, 2).every(([, init]) => init!.signal!.aborted)).toBe(true);
    expect(pipeline.take(proxy('b.ts'))).toBeUndefined();
    await expect(old).resolves.toBeNull();
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3));
    pipeline.clear();
    expect(request.mock.calls[2][1]!.signal!.aborted).toBe(true);
  });

  it('does not callback a destroyed HLS loader waiting on a fragment', async () => {
    let finish!: () => void;
    request.mockImplementation(() => new Promise(resolve => { finish = () => resolve(new Response(new Uint8Array([1]))); }));
    const pipeline = create();
    pipeline.prepare(proxy('a.ts'), proxy('b.ts'));
    const Cached = createHlsLoader(Hls, { networkLoader: Loader, foreground: pipeline });
    const success = vi.fn(), loader = new Cached({});
    loader.load({ url: proxy('b.ts') }, {}, { onSuccess: success });
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    loader.abort(); finish();
    await pipeline.take(proxy('b.ts'));
    expect(success).not.toHaveBeenCalled();
    expect(mocks.network).not.toHaveBeenCalled();
  });

  it('lets the normal HLS loader recover after speculative fetch failure', async () => {
    request.mockRejectedValue(new TypeError('network unavailable'));
    const pipeline = create();
    pipeline.prepare(proxy('a.ts'), proxy('b.ts'));
    await expect(pipeline.take(proxy('b.ts'))).resolves.toBeNull();
    const Cached = createHlsLoader(Hls, { networkLoader: Loader, foreground: pipeline });
    new Cached({}).load({ url: proxy('b.ts') }, {}, { onSuccess: vi.fn() });
    await vi.waitFor(() => expect(mocks.network).toHaveBeenCalledOnce());
  });

  it('reuses persisted fragments and cancels before a delayed cache lookup starts a request', async () => {
    const hit = { data: new Uint8Array([7]).buffer, costMs: 200 };
    mocks.cache.mockResolvedValue(hit);
    const pipeline = create();
    pipeline.prepare(proxy('a.ts'), proxy('b.ts'));
    await expect(pipeline.take(proxy('b.ts'))).resolves.toEqual(hit);
    expect(request).not.toHaveBeenCalled();
    mocks.cache.mockResolvedValue(null);
    pipeline.prepare(proxy('c.ts'), proxy('d.ts'));
    pipeline.clear();
    await Promise.resolve();
    expect(request).not.toHaveBeenCalled();
  });

  it.each([401, 206])('rejects unexpected status %s', async status => {
    request.mockResolvedValue(new Response(new Uint8Array([1]), { status }));
    const pipeline = create();
    pipeline.prepare(proxy('a.ts'), proxy('b.ts'));
    await expect(pipeline.take(proxy('b.ts'))).resolves.toBeNull();
  });

  it('bounds memory even when Content-Length is missing', async () => {
    request.mockResolvedValue(new Response(new Uint8Array(8 * 1024 * 1024 + 1)));
    const pipeline = create();
    pipeline.prepare(proxy('a.ts'), proxy('b.ts'));
    await expect(pipeline.take(proxy('b.ts'))).resolves.toBeNull();
    expect(request.mock.calls[0][1]!.signal!.aborted).toBe(true);
  });

  it('does not prefetch cross-origin URLs, keys, playlists or MP4', async () => {
    const pipeline = create();
    for (const next of ['https://cdn.example/a.ts', proxy('key.key'), proxy('index.m3u8'), proxy('a.mp4')]) {
      pipeline.prepare(proxy('a.ts'), next);
    }
    pipeline.prepare('https://cdn.example/a.ts', proxy('b.ts'));
    await Promise.resolve();
    expect(request).not.toHaveBeenCalled();
  });

  it('falls back when response headers never arrive', async () => {
    vi.useFakeTimers();
    request.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')), { once: true });
    }));
    const pipeline = create();
    pipeline.prepare(proxy('a.ts'), proxy('b.ts'));
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(pipeline.take(proxy('b.ts'))).resolves.toBeNull();
  });

  it('limits idle body time without truncating a progressing download', async () => {
    vi.useFakeTimers();
    let push!: () => void;
    request.mockResolvedValue(new Response(new ReadableStream({ start(output) {
      push = () => output.enqueue(new Uint8Array([1]));
    } })));
    const pipeline = create();
    pipeline.prepare(proxy('a.ts'), proxy('b.ts'));
    await vi.advanceTimersByTimeAsync(20_000);
    push();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(request.mock.calls[0][1]!.signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(pipeline.take(proxy('b.ts'))).resolves.toBeNull();
    expect(request.mock.calls[0][1]!.signal!.aborted).toBe(true);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Hls, { LoaderContextType, type LoaderStats } from 'hls.js';
import { createHlsLoader, playbackLoaders } from './hls-loader';

const mocks = vi.hoisted(() => ({ cache: vi.fn(), network: vi.fn() }));
vi.mock('./video-cache', () => ({ buildSegmentCacheKey: (url: string) => url, readCachedSegment: mocks.cache, touchMeta: vi.fn() }));
class Loader {
  stats = {} as LoaderStats;
  load = mocks.network;
  abort() {}
  destroy() {}
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('self', globalThis);
  vi.stubGlobal('document', { baseURI: 'https://tv.example/watch' });
  vi.stubGlobal('location', { origin: 'https://tv.example' });
  mocks.cache.mockResolvedValue({ data: new Uint8Array([1, 2, 3]).buffer, costMs: 50 });
});
afterEach(() => vi.unstubAllGlobals());

describe('progressive playback loading', () => {
  it('keeps progressive mode enabled with the real hls.js configuration', () => {
    const hls = new Hls(playbackLoaders(Hls, false));
    expect(hls.config.progressive).toBe(true);
    expect(hls.config.fLoader).toBeDefined();
    expect(hls.config.pLoader).toBeDefined();
    hls.destroy();
  });

  it('delivers cached bytes exactly once through the progressive callback', async () => {
    const Cached = createHlsLoader(Hls, { networkLoader: Loader, progressive: true });
    const progress = vi.fn(), success = vi.fn();
    new Cached({}).load({ url: 'https://cdn.example/a.ts', frag: { sn: 1 } }, {}, { onProgress: progress, onSuccess: success });
    await Promise.resolve();
    expect(progress).toHaveBeenCalledOnce();
    expect(new Uint8Array(progress.mock.calls[0][2])).toEqual(new Uint8Array([1, 2, 3]));
    expect(success.mock.calls[0][0].data.byteLength).toBe(0);
    expect(mocks.network).not.toHaveBeenCalled();
  });

  it('does not invoke callbacks after a cache lookup was aborted', async () => {
    const Cached = createHlsLoader(Hls, { networkLoader: Loader, progressive: true });
    const onProgress = vi.fn(), onSuccess = vi.fn();
    const callbacks = { onProgress, onSuccess };
    const loader = new Cached({});
    loader.load({ url: 'https://cdn.example/a.ts', frag: {} }, {}, callbacks);
    loader.abort();
    await Promise.resolve();
    expect(onProgress).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('adds foreground priority only for complete same-origin proxy TS requests', async () => {
    const setup = playbackLoaders(Hls, false).fetchSetup!;
    const proxy = 'https://tv.example/api/proxy?url=' + encodeURIComponent('https://cdn.example/a.ts');
    const context = (url: string) => ({ url, responseType: 'arraybuffer', type: LoaderContextType.MEDIA_FRAGMENT });
    expect((await setup(context(proxy), {})).headers.get('x-playback-priority')).toBe('foreground');
    expect((await setup(context(proxy), { headers: { Range: 'bytes=0-99' } })).headers.has('x-playback-priority')).toBe(false);
    expect((await setup(context('https://cdn.example/a.ts'), {})).headers.has('x-playback-priority')).toBe(false);
  });
});

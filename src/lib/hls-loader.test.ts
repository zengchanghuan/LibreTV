import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Hls, { LoaderContextType } from 'hls.js';
import type { LoaderCallbacks, LoaderContext, LoaderStats } from 'hls.js';
import { createHlsLoader, playbackLoaders } from './hls-loader';

const mocks = vi.hoisted(() => ({
  record: vi.fn(), readCache: vi.fn(), network: vi.fn(), touch: vi.fn(), strip: vi.fn(),
}));
vi.mock('./direct-connection', () => ({ recordDirectRequest: mocks.record }));
vi.mock('./video-cache', () => ({
  buildSegmentCacheKey: (url: string) => url,
  readCachedSegment: mocks.readCache,
  touchMeta: mocks.touch,
}));
vi.mock('./m3u8', () => ({ stripAdGroups: mocks.strip }));

const keyBytes = new Uint8Array(16).fill(7).buffer;

class NetworkLoader {
  stats = {} as LoaderStats;
  load(context: LoaderContext, _config: unknown, callbacks: LoaderCallbacks<LoaderContext>) {
    mocks.network(context.url);
    callbacks.onSuccess({
      url: 'https://redirect.example/media',
      data: context.type === LoaderContextType.KEY ? keyBytes : '#EXTM3U\noriginal',
    }, this.stats, context, null);
  }
  abort() {}
  destroy() {}
}
const FakeHls = { DefaultConfig: { loader: NetworkLoader } } as unknown as typeof Hls;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readCache.mockResolvedValue(null);
  mocks.strip.mockReturnValue('#EXTM3U\nfiltered');
});
afterEach(() => vi.unstubAllGlobals());

describe('host collection preserves HLS loading', () => {
  it('retains playlist filtering and forwards the callback once, including redirect hosts', () => {
    const Loader = createHlsLoader(FakeHls, { blockAd: true });
    const onSuccess = vi.fn();
    const context = { type: 'manifest', url: 'https://manifest.example/index.m3u8' };
    new Loader({}).load(context, {}, { onSuccess });
    expect(mocks.strip).toHaveBeenCalledWith('#EXTM3U\noriginal');
    expect(onSuccess).toHaveBeenCalledOnce();
    expect(onSuccess.mock.calls[0][0].data).toBe('#EXTM3U\nfiltered');
    expect(mocks.record.mock.calls.map(([url]) => url)).toEqual([context.url, 'https://redirect.example/media']);
  });

  it('records cached segments without making a network request or losing probe stats', async () => {
    const data = new ArrayBuffer(128);
    mocks.readCache.mockResolvedValue({ data, costMs: 40 });
    const onProbe = vi.fn(), onSuccess = vi.fn();
    const Loader = createHlsLoader(FakeHls, { onProbe });
    new Loader({}).load({ url: 'https://segment.example/a.ts' }, {}, { onSuccess });
    await Promise.resolve();
    expect(mocks.network).not.toHaveBeenCalled();
    expect(onProbe).toHaveBeenCalledWith(true);
    expect(onSuccess).toHaveBeenCalledOnce();
    expect(onSuccess.mock.calls[0][0].data).toBe(data);
    expect(onSuccess.mock.calls[0][1].loaded).toBe(128);
    expect(mocks.record).toHaveBeenCalledWith('https://segment.example/a.ts');
  });

  it.each([true, false])('collects key redirects through the configured default loader (streaming: %s)', (streaming) => {
    vi.stubGlobal('self', globalThis);
    if (!streaming) vi.stubGlobal('fetch', undefined);
    const onFragment = vi.fn(), onSuccess = vi.fn();
    const hls = new Hls(playbackLoaders(FakeHls, true, undefined, onFragment));
    try {
      // hls.js key-loader uses config.loader, independently of pLoader/fLoader.
      const loader = new hls.config.loader(hls.config);
      expect(loader).toBeInstanceOf(NetworkLoader);
      const context = { type: LoaderContextType.KEY, responseType: 'arraybuffer', url: 'https://key.example/a.key' };
      loader.load(context, {
        loadPolicy: hls.config.keyLoadPolicy.default,
        timeout: 1000, maxRetry: 0, retryDelay: 0, maxRetryDelay: 0,
      }, { onSuccess, onError: vi.fn(), onTimeout: vi.fn(), onAbort: vi.fn() });
      expect(mocks.network).toHaveBeenCalledOnce();
      expect(mocks.network).toHaveBeenCalledWith(context.url);
      expect(mocks.readCache).not.toHaveBeenCalled();
      expect(onFragment).not.toHaveBeenCalled();
      expect(mocks.strip).not.toHaveBeenCalled();
      expect(onSuccess).toHaveBeenCalledOnce();
      expect(onSuccess.mock.calls[0][0].data).toBe(keyBytes);
      expect(mocks.record.mock.calls.map(([url]) => url)).toEqual([context.url, 'https://redirect.example/media']);
      loader.destroy();
    } finally {
      hls.destroy();
    }
  });
});

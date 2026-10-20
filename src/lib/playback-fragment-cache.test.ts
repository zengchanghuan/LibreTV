import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaybackFragmentCache } from './playback-fragment-cache';

const mocks = vi.hoisted(() => ({ has: vi.fn(), put: vi.fn(), evict: vi.fn(), settings: vi.fn() }));
vi.mock('./video-cache', () => ({
  buildSegmentCacheKey: (url: string) => new URL(url, 'https://tv.example').href,
  hasCachedSegment: mocks.has, putCachedSegmentResilient: mocks.put,
  enforceQuota: mocks.evict, loadCacheSettings: mocks.settings,
}));
const url = (name = 'a.ts') => '/api/proxy?url=' + encodeURIComponent('https://cdn.example/' + name);
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('location', { origin: 'https://tv.example' });
  mocks.settings.mockReturnValue({ enabled: true });
  mocks.has.mockResolvedValue(false);
  mocks.put.mockResolvedValue('ok');
  mocks.evict.mockResolvedValue(0);
});
afterEach(() => vi.unstubAllGlobals());

describe('playback fragment reuse without more network traffic', () => {
  it('copies bytes before HLS transfers the buffer, retaining episode and timing metadata', async () => {
    const data = new Uint8Array([1, 2, 3]).buffer;
    new PlaybackFragmentCache('episode-1').remember(url(), data, 7, 423);
    structuredClone(data, { transfer: [data] });
    expect(data.byteLength).toBe(0);
    await vi.waitFor(() => expect(mocks.put).toHaveBeenCalledOnce());
    const [key, copy, meta] = mocks.put.mock.calls[0];
    expect(key).toBe('https://tv.example' + url());
    expect(new Uint8Array(copy)).toEqual(new Uint8Array([1, 2, 3]));
    expect(meta).toMatchObject({ episodeKey: 'episode-1', index: 7, costMs: 423 });
    expect(mocks.evict).toHaveBeenCalledOnce();
  });

  it('avoids duplicate writes and leaves existing fragments untouched', async () => {
    mocks.has.mockResolvedValue(true);
    const cache = new PlaybackFragmentCache('episode-1');
    cache.remember(url(), new ArrayBuffer(10), 1, 100);
    cache.remember(url(), new ArrayBuffer(10), 1, 100);
    await vi.waitFor(() => expect(mocks.has).toHaveBeenCalledOnce());
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it('honors disabled caching and rejects keys, playlists, direct URLs and oversized fragments', async () => {
    const cache = new PlaybackFragmentCache('episode-1');
    for (const target of [url('key.key'), url('index.m3u8'), 'https://cdn.example/a.ts']) {
      cache.remember(target, new ArrayBuffer(10), 1, 100);
    }
    cache.remember(url(), new ArrayBuffer(8 * 1024 * 1024 + 1), 1, 100);
    mocks.settings.mockReturnValue({ enabled: false });
    cache.remember(url(), new ArrayBuffer(10), 1, 100);
    expect(mocks.has).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it('bounds copies while storage is slow and drops stale writes after episode teardown', async () => {
    const finish: Array<(hit: boolean) => void> = [];
    mocks.has.mockImplementation(() => new Promise(resolve => { finish.push(resolve); }));
    const cache = new PlaybackFragmentCache('episode-1');
    cache.remember(url('a.ts'), new ArrayBuffer(8 * 1024 * 1024), 1, 100);
    cache.remember(url('b.ts'), new ArrayBuffer(8 * 1024 * 1024), 2, 100);
    cache.remember(url('c.ts'), new ArrayBuffer(1), 3, 100);
    expect(mocks.has).toHaveBeenCalledTimes(2);
    cache.dispose(); finish.forEach(resolve => resolve(false));
    await Promise.resolve();
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it('tolerates unavailable storage and continues caching later fragments', async () => {
    mocks.has.mockRejectedValueOnce(new Error('storage unavailable'));
    const cache = new PlaybackFragmentCache('episode-1');
    cache.remember(url(), new ArrayBuffer(10), 1, 100);
    await Promise.resolve();
    cache.remember(url('b.ts'), new ArrayBuffer(10), 2, 100);
    await vi.waitFor(() => expect(mocks.put).toHaveBeenCalledOnce());
  });
});

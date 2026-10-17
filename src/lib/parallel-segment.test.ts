import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchForegroundSegment, isForegroundSegment } from './parallel-segment';
import { fetchWithSafeRedirects } from './fetch-utils';

vi.mock('./fetch-utils', () => ({ fetchWithSafeRedirects: vi.fn() }));
const upstream = vi.mocked(fetchWithSafeRedirects);
const data = new Uint8Array(700_000).map((_, i) => i % 251);
let counter = 0;
const url = () => `https://range-${counter++}.example/video.ts`;
function mockRanges(change?: (response: Response, start: number) => Response) {
  upstream.mockImplementation(async (target, init) => {
    const range = new Headers(init?.headers).get('range');
    const [start, requestedEnd] = range!.slice(6).split('-').map(Number);
    const end = Math.min(requestedEnd, data.length - 1);
    const response = new Response(data.slice(start, end + 1), { status: 206, headers: {
      'Content-Range': `bytes ${start}-${end}/${data.length}`, ETag: '"stable"', 'Content-Type': 'video/mp2t',
    } });
    return { res: change?.(response, start) ?? response, finalUrl: target };
  });
}
afterEach(() => vi.clearAllMocks());

describe('foreground segment ranges', () => {
  it('starts three bounded requests and reproduces every byte in order', async () => {
    mockRanges();
    const result = await fetchForegroundSegment(url(), {}, 8000);
    expect(upstream).toHaveBeenCalledTimes(3);
    expect(result.res.status).toBe(200);
    expect(result.res.headers.get('content-range')).toBeNull();
    expect(result.res.headers.get('x-playback-ranges')).toBe('3');
    expect(new Headers(upstream.mock.calls[1][1]?.headers).get('if-range')).toBe('"stable"');
    expect(new Uint8Array(await result.res.arrayBuffer())).toEqual(data);
  });

  it('passes through servers that ignore Range without duplicating the download', async () => {
    upstream.mockImplementation(async target => ({ res: new Response(data), finalUrl: target }));
    const result = await fetchForegroundSegment(url(), {}, 8000);
    expect(new Uint8Array(await result.res.arrayBuffer())).toEqual(data);
    expect(upstream).toHaveBeenCalledOnce();
  });

  it.each(['W/"weak"', '', '"bad\"tag"'])('falls back to a whole file for unusable ETag %s', async etag => {
    upstream.mockImplementation(async (target, init) => ({
      finalUrl: target,
      res: new Headers(init?.headers).has('range')
        ? new Response(data.slice(0, 262144), { status: 206, headers: { ETag: etag, 'Content-Range': `bytes 0-262143/${data.length}` } })
        : new Response(data),
    }));
    const result = await fetchForegroundSegment(url(), {}, 8000);
    expect(new Uint8Array(await result.res.arrayBuffer())).toEqual(data);
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(new Headers(upstream.mock.calls[1][1]?.headers).has('range')).toBe(false);
  });

  it.each(['version', 'position', 'length', 'ignored'])('rejects inconsistent %s and disables acceleration on retry', async fault => {
    mockRanges((res, start) => {
      if (!start) return res;
      if (fault === 'version') res.headers.set('etag', '"changed"');
      if (fault === 'position') res.headers.set('content-range', `bytes 0-262143/${data.length}`);
      if (fault === 'ignored') return new Response(data);
      if (fault === 'length') return new Response(new Uint8Array(4), { status: 206, headers: res.headers });
      return res;
    });
    const target = url();
    const result = await fetchForegroundSegment(target, {}, 8000);
    await expect(result.res.arrayBuffer()).rejects.toBeDefined();
    upstream.mockImplementation(async next => ({ res: new Response(data), finalUrl: next }));
    const retry = await fetchForegroundSegment(target, {}, 8000);
    expect(new Headers(upstream.mock.lastCall?.[1]?.headers).has('range')).toBe(false);
    expect(new Uint8Array(await retry.res.arrayBuffer())).toEqual(data);
  });

  it('aborts all requests when the viewer seeks away', async () => {
    mockRanges();
    const result = await fetchForegroundSegment(url(), {}, 8000);
    await result.res.body!.cancel('seek');
    expect(upstream.mock.calls.every(([, init]) => init?.signal?.aborted)).toBe(true);
  });

  it('excludes prefetch, playlists, MP4, and caller byte ranges', () => {
    const request = (headers = {}) => new Request('https://tv.example/api/proxy', { headers });
    expect(isForegroundSegment(request(), 'https://cdn.example/a.ts')).toBe(false);
    const high = { 'X-Playback-Priority': 'foreground' };
    expect(isForegroundSegment(request(high), 'https://cdn.example/a.ts')).toBe(true);
    expect(isForegroundSegment(request(high), 'https://cdn.example/a.m3u8')).toBe(false);
    expect(isForegroundSegment(request(high), 'https://cdn.example/a.mp4')).toBe(false);
    expect(isForegroundSegment(request({ ...high, Range: 'bytes=0-9' }), 'https://cdn.example/a.ts')).toBe(false);
  });
});

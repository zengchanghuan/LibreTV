import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './client-api';
vi.mock('./client-api', () => ({ api: { detail: vi.fn() } }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
import { firstMediaReference, probePool, probeVideo } from './media-probe';
describe('media probing', () => {
  it('rejects HTML and finds real media or initialization segments', () => {
    expect(()=>firstMediaReference('<html>access denied</html>')).toThrow();
    expect(firstMediaReference('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100\nvariant.m3u8')).toBe('variant.m3u8');
    expect(firstMediaReference('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:4\nfirst.m4s')).toBe('first.m4s');
    expect(firstMediaReference('#EXTM3U\n#EXTINF:4\nfirst.ts\nsecond.ts')).toBe('first.ts');
  });
  it('bounds concurrency and stops scheduling after cancellation', async () => {
    const c=new AbortController();let running=0,max=0,done=0;
    await probePool([1,2,3,4,5,6],async()=>{running++;max=Math.max(max,running);await Promise.resolve();running--;done++;c.abort();},c.signal);
    expect(max).toBe(3);expect(done).toBe(3);
  });
});

describe('media probe requests', () => {
  const source = { key:'test',name:'test',url:'https://catalog.example.org/api' };
  it('samples actual media bytes after following a master playlist', async () => {
    vi.mocked(api.detail).mockResolvedValue({episodes:['https://cdn.example.org/master.m3u8'],videoInfo:{sourceKey:'test',sourceName:'test'}});
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('master.m3u8')) return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\nvideo.m3u8');
      if (url.endsWith('video.m3u8')) return new Response('#EXTM3U\n#EXTINF:5\nfirst.ts');
      expect(url).toBe('https://cdn.example.org/first.ts');expect(options?.headers).toEqual({Range:'bytes=0-131071'});
      return new Response(new Uint8Array(131072), {headers:{'content-type':'video/mp2t'}});
    });
    vi.stubGlobal('fetch',fetchMock);
    expect(await probeVideo(source,'master-test',0,new AbortController().signal)).toMatchObject({ok:true,episodes:1});
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it('does not silently test episode one when the selected episode is absent', async () => {
    vi.mocked(api.detail).mockResolvedValue({episodes:['https://cdn.example.org/movie.mp4'],videoInfo:{sourceKey:'test',sourceName:'test'}});
    const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);
    expect(await probeVideo(source,'missing-episode',3,new AbortController().signal)).toMatchObject({ok:false,error:'该源缺少当前集'});
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('propagates user cancellation without producing a failed score', async () => {
    const c = new AbortController();c.abort();vi.mocked(api.detail).mockRejectedValue(new DOMException('cancelled','AbortError'));
    await expect(probeVideo(source,'cancelled',0,c.signal)).rejects.toThrow('cancelled');
  });
});

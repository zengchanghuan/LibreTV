import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './client-api';
vi.mock('./client-api', () => ({ api: { detail: vi.fn() } }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
import { clearMediaProbeCache, firstMediaReference, probePool, probeVideo } from './media-probe';
import { rewriteM3u8 } from './m3u8';
afterEach(clearMediaProbeCache);
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
  it('verifies a Chinese subtitle segment alongside the selected HD video', async () => {
    vi.mocked(api.detail).mockResolvedValue({ episodes: ['https://cdn.example.org/master.m3u8'], videoInfo: { sourceKey: 'test', sourceName: 'test' } });
    const pages: Record<string, string> = {
      'master.m3u8': '#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",LANGUAGE="zh",URI="subs.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=1920x1080,SUBTITLES="subs"\nhd.m3u8',
      'hd.m3u8': '#EXTM3U\n#EXTINF:5\nvideo.ts',
      'subs.m3u8': '#EXTM3U\n#EXTINF:5\nzh.vtt',
      'zh.vtt': 'WEBVTT\n\n00:00.000 --> 00:03.000\n中文字幕',
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const path = new URL(url).pathname.slice(1);
      return pages[path] ? new Response(pages[path]) : new Response(new Uint8Array(131072), { headers: { 'content-type': 'video/mp2t' } });
    }));
    expect(await probeVideo(source, 'subbed', 0, new AbortController().signal)).toMatchObject({ ok: true, height: 1080, subtitles: 'verified', subtitleLanguage: 'zh', bandwidth: 4000000 });
  });
  it('retains playable status when subtitle requests fail, including through the proxy', async () => {
    vi.mocked(api.detail).mockResolvedValue({ episodes: ['https://cdn.example.org/master.m3u8'], videoInfo: { sourceKey: 'test', sourceName: 'test' } });
    const manifest = '#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="sub",URI="zh.vtt"\n#EXT-X-STREAM-INF:RESOLUTION=1280x720,SUBTITLES="sub"\nvideo.m3u8';
    vi.stubGlobal('fetch', vi.fn(async (raw: string) => {
      if (raw.startsWith('https://cdn.example.org/')) throw new TypeError('CORS');
      const url = new URL(raw, 'http://localhost');
      const target = url.searchParams.get('url')!;
      if (target.endsWith('master.m3u8')) return new Response(rewriteM3u8(manifest, target));
      if (target.endsWith('video.m3u8')) return new Response(rewriteM3u8('#EXTM3U\n#EXTINF:5\nvideo.ts', target));
      if (target.endsWith('zh.vtt')) return new Response('<html>denied</html>', { status: 403 });
      expect(target).toBe('https://cdn.example.org/video.ts');
      return new Response(new Uint8Array(131072), { headers: { 'content-type': 'video/mp2t' } });
    }));
    expect(await probeVideo(source, 'proxy-subtitle', 0, new AbortController().signal)).toMatchObject({ ok: true, height: 720, subtitles: 'declared' });
  });
  it('keeps plain MP4 subtitle status unknown and isolates cache per film and episode', async () => {
    vi.mocked(api.detail).mockResolvedValue({ episodes: ['https://cdn.example.org/movie.mp4'], videoInfo: { sourceKey: 'test', sourceName: 'test' } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(131072), { headers: { 'content-type': 'video/mp4' } })));
    expect(await probeVideo(source, 'mp4', 0, new AbortController().signal)).toMatchObject({ ok: true, subtitles: 'unknown' });
    await probeVideo(source, 'mp4', 0, new AbortController().signal);
    expect(api.detail).toHaveBeenCalledTimes(1);
    await probeVideo(source, 'another-film', 0, new AbortController().signal);
    await probeVideo(source, 'mp4', 1, new AbortController().signal);
    expect(api.detail).toHaveBeenCalledTimes(3);
  });
  it.each(['data:text/plain,WEBVTT', 'empty.vtt', 'error.vtt'])('does not verify unusable subtitle %s or fail its video', async uri => {
    vi.mocked(api.detail).mockResolvedValue({ episodes: ['https://cdn.example.org/master.m3u8'], videoInfo: { sourceKey: 'test', sourceName: 'test' } });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('master.m3u8')) return new Response(`#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="sub",URI="${uri}"\n#EXT-X-STREAM-INF:RESOLUTION=1280x720,SUBTITLES="sub"\nvideo.m3u8`);
      if (url.endsWith('video.m3u8')) return new Response('#EXTM3U\n#EXTINF:5\nvideo.ts');
      if (url.endsWith('empty.vtt')) return new Response('WEBVTT\n\n');
      if (url.endsWith('error.vtt')) return new Response('<html>Access denied</html>');
      expect(url).toBe('https://cdn.example.org/video.ts');
      return new Response(new Uint8Array(131072), { headers: { 'content-type': 'video/mp2t' } });
    }));
    expect(await probeVideo(source, uri, 0, new AbortController().signal)).toMatchObject({ ok: true, height: 720, subtitles: 'declared' });
  });
  it('propagates user cancellation without producing a failed score', async () => {
    const c = new AbortController();c.abort(new DOMException('cancelled','AbortError'));vi.mocked(api.detail).mockRejectedValue(new DOMException('cancelled','AbortError'));
    await expect(probeVideo(source,'cancelled',0,c.signal)).rejects.toThrow('cancelled');
  });
});

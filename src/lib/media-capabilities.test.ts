import { describe, expect, it } from 'vitest';
import { hasSubtitleCue, inspectHls, sourceClaims } from './media-capabilities';
import { rewriteM3u8 } from './m3u8';

describe('rendition metadata', () => {
  it('ties resolution and subtitles to the selected video rendition, not other groups', () => {
    const manifest = inspectHls(`#EXTM3U
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="low",LANGUAGE="zh",URI="wrong.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="hd",NAME="English, CC",LANGUAGE="en",URI="en.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="hd",LANGUAGE="zh-Hans",URI="zh.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=600000,RESOLUTION=640x360,SUBTITLES="low"
low.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=6000000,AVERAGE-BANDWIDTH=4000000,RESOLUTION=1920x1080,SUBTITLES="hd"
hd.m3u8`);
    expect(manifest.variant).toMatchObject({ uri: 'hd.m3u8', height: 1080, bandwidth: 4000000 });
    expect(manifest.tracks.map(t => t.uri)).toEqual(['zh.m3u8', 'en.m3u8']);
  });
  it('does not invent metadata for a media-only playlist', () => {
    expect(inspectHls('#EXTM3U\n#EXTINF:5\n1.ts')).toMatchObject({ variant: undefined, tracks: [], captions: false });
  });
  it('requires a nonempty WebVTT cue, not a header, filename or error page', () => {
    expect(hasSubtitleCue('WEBVTT\n\n00:00.000 --> 00:01.000\n你好')).toBe(true);
    expect(hasSubtitleCue('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello')).toBe(true);
    expect(hasSubtitleCue('WEBVTT\n\n')).toBe(false);
    expect(hasSubtitleCue('WEBVTT\n\n00:00.000 --> 00:01.000\n\n')).toBe(false);
    expect(hasSubtitleCue('<html>WEBVTT unavailable</html>')).toBe(false);
  });
  it('keeps source claims distinct and rejects negative subtitle labels', () => {
    expect(sourceClaims('1080P 中英双语字幕')).toEqual({ height: 1080, subtitles: true });
    expect(sourceClaims('4K 无中文字幕')).toEqual({ height: 2160, subtitles: false });
    expect(sourceClaims('国语高清')).toEqual({ height: undefined, subtitles: false });
  });
  it('rewrites subtitle/audio rendition URIs against the redirected upstream base once', () => {
    const source = '#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="sub",URI="../zh/index.m3u8"';
    const rewritten = rewriteM3u8(source, 'https://cdn.example.org/redirect/master.m3u8');
    expect(rewritten).toContain('URI="/api/proxy?url=https%3A%2F%2Fcdn.example.org%2Fzh%2Findex.m3u8"');
    expect(rewriteM3u8(rewritten, 'https://cdn.example.org/master.m3u8')).toBe(rewritten);
  });
});

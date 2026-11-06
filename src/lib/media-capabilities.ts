/** HLS metadata is evidence about one rendition, not proof of burned-in subtitles. */
export interface MediaCapabilities {
  height?: number;
  bandwidth?: number;
  subtitles?: 'verified' | 'declared' | 'unknown';
  subtitleLanguage?: string;
}
export interface SubtitleTrack { uri: string; language?: string }
function attributes(line: string): Record<string, string> {
  return Object.fromEntries([...line.matchAll(/([A-Z0-9-]+)=(?:"([^"]*)"|([^,\s]+))/g)]
    .map(m => [m[1], m[2] ?? m[3]]));
}
export const isChineseSubtitle = (language = '') => /^(zh|zho|chi)(-|$)|中文|简体|繁体|中字/i.test(language);

export function inspectHls(text: string) {
  if (!text.trimStart().startsWith('#EXTM3U')) throw new Error('不是有效的视频列表');
  const lines = text.split(/\r?\n/).map(line => line.trim());
  const variants = lines.flatMap((line, i) => {
    if (!line.startsWith('#EXT-X-STREAM-INF:')) return [];
    const attrs = attributes(line), uri = lines[i + 1];
    if (!uri || uri.startsWith('#')) return [];
    const height = Number(attrs.RESOLUTION?.match(/^\d+x(\d+)$/)?.[1]) || undefined;
    const bandwidth = Number(attrs['AVERAGE-BANDWIDTH'] || attrs.BANDWIDTH) || undefined;
    return [{ uri, attrs, height, bandwidth }];
  });
  // Measure a real HD rendition, rather than borrowing resolution from a different stream.
  const variant = variants.sort((a, b) => (b.height || 0) - (a.height || 0))[0];
  const tracks: SubtitleTrack[] = lines.filter(line => line.startsWith('#EXT-X-MEDIA:'))
    .map(attributes)
    .filter(a => a.TYPE === 'SUBTITLES' && a.URI && a['GROUP-ID'] && variant?.attrs.SUBTITLES === a['GROUP-ID'])
    .map(a => ({ uri: a.URI, language: a.LANGUAGE || a.NAME }))
    .sort((a, b) => Number(isChineseSubtitle(b.language)) - Number(isChineseSubtitle(a.language)));
  const captions = lines.filter(line => line.startsWith('#EXT-X-MEDIA:')).map(attributes)
    .some(a => a.TYPE === 'CLOSED-CAPTIONS' && !!a['GROUP-ID'] && variant?.attrs['CLOSED-CAPTIONS'] === a['GROUP-ID']);
  return { variant, tracks, captions };
}

/** An empty WebVTT header or an HTML error page is not a usable subtitle sample. */
export function hasSubtitleCue(text: string): boolean {
  return /^\uFEFF?WEBVTT(?:[ \t\r\n]|$)/.test(text) &&
    /(?:\d{2,}:)?\d{2}:\d{2}\.\d{3}\s+-->\s+(?:\d{2,}:)?\d{2}:\d{2}\.\d{3}[^\r\n]*\r?\n[^\S\r\n]*\S/.test(text);
}

/** Source labels are displayed as claims and never treated as detected media tracks. */
export function sourceClaims(remarks = '') {
  const height = /(?:2160p|4k)/i.test(remarks) ? 2160 : /1080[pi]/i.test(remarks) ? 1080 : /720p/i.test(remarks) ? 720 : undefined;
  const subtitles = !/无字幕|无字|无中[文]?字|生肉|no\s*sub/i.test(remarks) && /中字|中文字幕|双语字幕|中英|简繁|简体字幕|繁体字幕/.test(remarks);
  return { height, subtitles };
}

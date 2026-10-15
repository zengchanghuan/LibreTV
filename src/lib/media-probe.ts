'use client';
import { api } from './client-api';
import type { SourceConfig } from './types';
export interface MediaProbe { ok: boolean; ms: number; kbps?: number; episodes: number; error?: string }
/** Follow HLS master lists and the first media object, not merely the catalog response. */
export function firstMediaReference(text: string): string | undefined {
  if (!text.trimStart().startsWith('#EXTM3U')) throw new Error('不是有效的视频列表');
  return text.split(/\r?\n/).map(s => s.trim()).find(s => s && !s.startsWith('#')) || text.match(/#EXT-X-MAP:[^\n]*URI="([^"]+)"/)?.[1];
}
async function fetchMedia(url: string, signal: AbortSignal, sample = false): Promise<Response> {
  const options = { signal, headers: sample ? { Range: 'bytes=0-131071' } : undefined };
  try {
    const res = await fetch(url, options);
    if (res.ok) return res;
    await res.body?.cancel();
  } catch (err) { if (signal.aborted) throw err; }
  const res = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`, options);
  if (!res.ok) { await res.body?.cancel(); throw new Error(`媒体请求失败 ${res.status}`); }
  return res;
}
async function readPlaylist(res: Response): Promise<string> {
  const reader = res.body?.getReader(); if (!reader) throw new Error('视频列表为空');
  const decoder = new TextDecoder(); let text = '', bytes = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength; if (bytes > 1024 * 1024) throw new Error('视频列表过大');
      text += decoder.decode(part.value, { stream: true });
    }
    return text + decoder.decode();
  } finally { await reader.cancel().catch(() => {}); }
}
const cache = new Map<string, { at: number; value: MediaProbe }>();
export function clearMediaProbeCache() { cache.clear(); }
export async function probeVideo(source: SourceConfig, id: string, index: number, parent: AbortSignal): Promise<MediaProbe> {
  const key = `${source.url}|${id}|${index}`, cached = cache.get(key);
  if (cached && Date.now() - cached.at < 300000) return cached.value;
  const started = performance.now(), signal = AbortSignal.any([parent, AbortSignal.timeout(12000)]);
  let episodes = 0;
  try {
    const detail = await api.detail(id, source, signal); episodes = detail.episodes.length;
    let url = detail.episodes[index];
    if (!url) throw new Error('该源缺少当前集');
    let mp4 = /\.mp4(?:\?|$)/i.test(url);
    if (url.startsWith('/api/site-playback?')) {
      const res = await fetch(url, { signal }), data = await res.json();
      if (!res.ok) throw new Error(data.error || '解析失败');
      url = data.url; mp4 = data.type === 'mp4';
    }
    if (!/^https?:\/\//i.test(url)) throw new Error('无效的媒体地址');
    if (!mp4) {
      for (let depth = 0; depth < 3; depth++) {
        const res = await fetchMedia(url, signal);
        if ((res.headers.get('content-type') || '').includes('video/mp4')) { await res.body?.cancel(); break; }
        const text = await readPlaylist(res);
        const reference = firstMediaReference(text); if (!reference) throw new Error('视频列表没有媒体数据');
        const base = res.url.includes('/api/proxy?') ? window.location.origin : res.url || url;
        url = new URL(reference, base).href;
        if (!text.includes('#EXT-X-STREAM-INF')) break;
        if (depth === 2) throw new Error('视频列表嵌套过深');
      }
    }
    const sampleStart = performance.now(), res = await fetchMedia(url, signal, true);
    const ct = res.headers.get('content-type') || '';
    if (/html|json|xml|mpegurl/i.test(ct)) { await res.body?.cancel(); throw new Error('返回的不是媒体数据'); }
    const reader = res.body?.getReader(); if (!reader) throw new Error('无媒体数据');
    let bytes = 0;
    try { while (bytes < 131072) { const r = await reader.read(); if (r.done) break; bytes += r.value.byteLength; } }
    finally { await reader.cancel().catch(() => {}); }
    if (!bytes) throw new Error('媒体数据为空');
    const result = { ok: true, episodes, ms: Math.round(performance.now() - started), kbps: bytes >= 32768 ? Math.round(bytes * 8 / Math.max(1, performance.now() - sampleStart)) : undefined };
    if (cache.size > 100) cache.clear(); cache.set(key, { at: Date.now(), value: result }); return result;
  } catch (error) {
    if (parent.aborted) throw error;
    return { ok: false, episodes, ms: Math.round(performance.now() - started), error: error instanceof Error ? error.message : '测速失败' };
  }
}
export async function probePool<T>(items: T[], run: (item: T) => Promise<void>, signal: AbortSignal) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(3, items.length) }, async () => {
    while (!signal.aborted) { const item = items[cursor++]; if (item === undefined) return; await run(item); }
  }));
}

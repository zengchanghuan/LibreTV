import { buildSegmentCacheKey, readCachedSegment, type CachedFragment } from './video-cache';
import { streamWithIdleTimeout } from './stream-timeout';

const MAX_BYTES = 8 * 1024 * 1024;
interface Entry {
  controller: AbortController;
  result: Promise<CachedFragment | null>;
}

/** Only same-origin, complete proxy TS fragments qualify; never keys or live data. */
function eligible(url: string | undefined): string | undefined {
  if (!url) return;
  try {
    const parsed = new URL(url, document.baseURI);
    const target = new URL(parsed.searchParams.get('url') || '');
    if (parsed.origin === location.origin && parsed.pathname === '/api/proxy' &&
        /^https?:$/.test(target.protocol) && target.pathname.toLowerCase().endsWith('.ts')) return parsed.href;
  } catch { /* Unsupported URL: leave it to the normal loader. */ }
}

/**
 * A player-local one-fragment lookahead. HLS still decodes complete fragments,
 * but its next download can overlap the current one near an empty buffer.
 * At most the current and next entries (8 MiB each) survive; a seek/teardown
 * cancels them, and errors fall back to the ordinary HLS retry path.
 */
export class ForegroundPrefetcher {
  private entries = new Map<string, Entry>();
  private window?: { start: number; end: number };

  prepare(currentUrl: string, nextUrl?: string, window?: { start: number; end: number }): void {
    const current = eligible(currentUrl), next = current ? eligible(nextUrl) : undefined;
    this.window = current ? window : undefined;
    for (const [url, entry] of this.entries) {
      if (url !== current && url !== next) {
        entry.controller.abort();
        this.entries.delete(url);
      }
    }
    if (!next || next === current || this.entries.has(next)) return;
    const controller = new AbortController();
    this.entries.set(next, { controller, result: this.download(next, controller).catch(() => null) });
  }

  take(url: string): Promise<CachedFragment | null> | undefined {
    const key = eligible(url);
    return key ? this.entries.get(key)?.result : undefined;
  }

  clear(): void {
    for (const entry of this.entries.values()) entry.controller.abort();
    this.entries.clear();
    this.window = undefined;
  }

  seek(time: number): void {
    // A drag can emit several seeks inside the same fragment. HLS keeps its
    // current request in that case, so retain its still-useful lookahead too.
    if (this.window && time >= this.window.start && time < this.window.end) return;
    this.clear();
  }

  private async download(url: string, controller: AbortController): Promise<CachedFragment | null> {
    const cached = await readCachedSegment(buildSegmentCacheKey(url));
    if (controller.signal.aborted) return null;
    if (cached) return cached.data.byteLength <= MAX_BYTES ? cached : null;
    const started = performance.now();
    const timer = setTimeout(() => controller.abort(), 15_000);
    let response: Response;
    try {
      response = await fetch(url, {
        credentials: 'same-origin', signal: controller.signal,
        headers: { 'X-Playback-Priority': 'foreground' },
      });
    } finally { clearTimeout(timer); }
    if (response.status !== 200 || !response.body || Number(response.headers.get('content-length')) > MAX_BYTES) {
      await response.body?.cancel();
      return null;
    }
    const reader = streamWithIdleTimeout(response.body, 30_000, reason => controller.abort(reason)).getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES || controller.signal.aborted) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    reader.releaseLock();
    if (!size || controller.signal.aborted) return null;
    const data = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    return { data: data.buffer, costMs: Math.max(1, performance.now() - started) };
  }
}

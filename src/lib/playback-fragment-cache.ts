import { buildSegmentCacheKey, enforceQuota, hasCachedSegment, loadCacheSettings, putCachedSegmentResilient } from './video-cache';

const MAX_FRAGMENT_BYTES = 8 * 1024 * 1024;
const MAX_PENDING_BYTES = 16 * 1024 * 1024;

/** Save bytes already downloaded for VOD playback; never start a network request. */
export class PlaybackFragmentCache {
  private pending = new Set<string>();
  private pendingBytes = 0;
  private lastEviction = 0;
  private disposed = false;

  constructor(private episodeKey?: string) {}

  remember(url: string, data: ArrayBuffer, index: number, costMs: number): void {
    const settings = loadCacheSettings();
    if (this.disposed || !this.episodeKey || !settings.enabled || index < 1 ||
        !data.byteLength || data.byteLength > MAX_FRAGMENT_BYTES ||
        this.pendingBytes + data.byteLength > MAX_PENDING_BYTES) return;
    const key = buildSegmentCacheKey(url);
    try {
      const parsed = new URL(key);
      const source = new URL(parsed.searchParams.get('url') || '');
      if (parsed.origin !== location.origin || parsed.pathname !== '/api/proxy' ||
          !/^https?:$/.test(source.protocol) || !source.pathname.toLowerCase().endsWith('.ts')) return;
    } catch { return; }
    if (this.pending.has(key)) return;
    // hls.js can transfer the original buffer as soon as its loader completes.
    // Copy synchronously, before the first asynchronous storage operation.
    const copy = data.slice(0);
    this.pending.add(key);
    this.pendingBytes += copy.byteLength;
    const bytes = copy.byteLength;
    const episodeKey = this.episodeKey;
    void (async () => {
      try {
        const hit = await hasCachedSegment(key);
        if (hit || this.disposed) return;
        const result = await putCachedSegmentResilient(key, copy, { episodeKey, index, costMs, settings });
        if (result === 'ok' && Date.now() - this.lastEviction >= 15_000) {
          this.lastEviction = Date.now();
          await enforceQuota(settings);
        }
      } catch { /* Optional storage must never interrupt playback. */ }
      finally { this.pending.delete(key); this.pendingBytes -= bytes; }
    })();
  }

  dispose(): void { this.disposed = true; }
}

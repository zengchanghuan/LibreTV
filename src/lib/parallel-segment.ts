import { fetchWithSafeRedirects, type FetchResult } from './fetch-utils';
import { streamWithIdleTimeout } from './stream-timeout';

const FIRST_BYTES = 256 * 1024;
const MAX_BYTES = 8 * 1024 * 1024;
const IDLE_MS = 30_000;
// A failed range must not make every player retry repeat the same failure.
const disabledUntil = new Map<string, number>();

function rangeInfo(response: Response) {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
  if (!match) return null;
  const [start, end, total] = match.slice(1).map(Number);
  if (![start, end, total].every(Number.isSafeInteger) || start > end || end >= total) return null;
  return { start, end, total };
}

/** Only explicit same-origin foreground TS loads use bounded range acceleration. */
export function isForegroundSegment(req: Request, target: string): boolean {
  return req.headers.get('x-playback-priority') === 'foreground' &&
    !req.headers.has('range') && new URL(target).pathname.toLowerCase().endsWith('.ts');
}

/**
 * Fetch the remainder on two connections, forwarding every range as it arrives.
 * Every range must share a strong ETag and exact total. At most three upstream
 * requests and 8 MiB per segment; background fetch and caller ranges are excluded.
 */
export async function fetchForegroundSegment(url: string, init: RequestInit, headerTimeoutMs: number): Promise<FetchResult> {
  const host = new URL(url).host;
  const plain = () => fetchWithSafeRedirects(url, init, { headerTimeoutMs });
  if ((disabledUntil.get(host) || 0) > Date.now()) return plain();
  const controller = new AbortController();
  const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
  const headers = new Headers(init.headers);
  headers.set('Range', `bytes=0-${FIRST_BYTES - 1}`);
  headers.set('Accept-Encoding', 'identity');
  const first = await fetchWithSafeRedirects(url, { ...init, headers, signal }, { headerTimeoutMs });
  if (first.res.status === 200) return first; // Range ignored: already the full resource.
  const info = rangeInfo(first.res);
  const etag = first.res.headers.get('etag');
  const encoding = first.res.headers.get('content-encoding');
  if (first.res.status !== 206 || !first.res.body || !info || info.start !== 0 ||
      info.end !== Math.min(FIRST_BYTES, info.total) - 1 || info.total > MAX_BYTES ||
      !etag || !/^"[^"\r\n]*"$/.test(etag) || (encoding && encoding !== 'identity')) {
    controller.abort();
    await first.res.body?.cancel().catch(() => {});
    return plain();
  }
  const disable = () => {
    if (disabledUntil.size >= 64) disabledUntil.delete(disabledUntil.keys().next().value!);
    disabledUntil.set(host, Date.now() + 5 * 60_000);
  };
  const ranges: Array<[number, number]> = [];
  const remaining = info.total - info.end - 1;
  if (remaining > 0) {
    const split = info.end + 1 + Math.ceil(remaining / 2);
    ranges.push([info.end + 1, split - 1]);
    if (split < info.total) ranges.push([split, info.total - 1]);
  }
  // Future ranges may fill their bounded queues while an earlier range is sent.
  // Do not await a whole range before forwarding it: that serializes upstream
  // download and downstream delivery on slower viewer connections.
  let cancelled = false;
  const parts = ranges.map(([start, end]) => new ReadableStream<Uint8Array>({ async start(output) {
    try {
      const partHeaders = new Headers(headers);
      partHeaders.set('Range', `bytes=${start}-${end}`);
      partHeaders.set('If-Range', etag);
      const { res } = await fetchWithSafeRedirects(first.finalUrl, { ...init, headers: partHeaders, signal }, { headerTimeoutMs });
      const part = rangeInfo(res);
      if (res.status !== 206 || !res.body || !part || part.start !== start || part.end !== end ||
          part.total !== info.total || res.headers.get('etag') !== etag ||
          (res.headers.get('content-encoding') && res.headers.get('content-encoding') !== 'identity')) {
        await res.body?.cancel().catch(() => {});
        throw new Error('Upstream range changed or was ignored');
      }
      const reader = streamWithIdleTimeout(res.body, IDLE_MS, reason => controller.abort(reason)).getReader();
      let offset = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (offset + value.length > end - start + 1) { await reader.cancel(); throw new Error('Oversized upstream range'); }
        offset += value.length;
        output.enqueue(value);
      }
      if (offset !== end - start + 1) throw new Error('Truncated upstream range');
      reader.releaseLock();
      output.close();
    } catch (error) {
      if (!cancelled && !init.signal?.aborted) disable();
      controller.abort(error);
      output.error(error);
    }
  } }));
  const reader = first.res.body.getReader();
  let firstDone = false, firstSize = 0, nextPart = 0;
  let partReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    async pull(output) {
      try {
        if (!firstDone) {
          const { done, value } = await reader.read();
          if (cancelled) return;
          if (!done) {
            firstSize += value.length;
            if (firstSize > info.end + 1) throw new Error('Oversized initial range');
            output.enqueue(value); return;
          }
          if (firstSize !== info.end + 1) throw new Error('Truncated initial range');
          firstDone = true;
          reader.releaseLock();
        }
        while (nextPart < parts.length) {
          partReader ??= parts[nextPart].getReader();
          const { done, value } = await partReader.read();
          if (cancelled) return;
          if (!done) { output.enqueue(value); return; }
          partReader.releaseLock();
          partReader = undefined;
          nextPart++;
        }
        output.close();
      } catch (error) {
        if (cancelled) return;
        if (!init.signal?.aborted) disable();
        controller.abort(error);
        if (!firstDone) void reader.cancel(error).catch(() => {});
        output.error(error);
      }
    },
    cancel(reason) {
      cancelled = true;
      controller.abort(reason);
      void partReader?.cancel(reason).catch(() => {});
      if (!firstDone) return reader.cancel(reason);
    },
  }, { highWaterMark: 0 });
  const outHeaders = new Headers(first.res.headers);
  outHeaders.delete('content-range');
  outHeaders.set('content-length', String(info.total));
  outHeaders.set('x-playback-ranges', String(ranges.length + 1));
  return { res: new Response(stream, { status: 200, headers: outHeaders }), finalUrl: first.finalUrl };
}

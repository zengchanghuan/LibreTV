/** Limit gaps between upstream chunks, without cutting off a progressing download. */
export function streamWithIdleTimeout(
  body: ReadableStream<Uint8Array>,
  idleMs: number,
  abortUpstream: (reason: unknown) => void,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;
  const clear = () => { clearTimeout(timer); timer = undefined; };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      timer = setTimeout(() => {
        finished = true;
        const reason = new DOMException('Upstream body stalled', 'TimeoutError');
        controller.error(reason);
        abortUpstream(reason);
        void reader.cancel(reason).catch(() => {});
      }, idleMs);
      try {
        const { done, value } = await reader.read();
        clear();
        if (finished) return;
        if (done) { finished = true; controller.close(); reader.releaseLock(); }
        else controller.enqueue(value);
      } catch (error) {
        clear();
        if (!finished) { finished = true; controller.error(error); abortUpstream(error); }
      }
    },
    cancel(reason) {
      finished = true;
      clear();
      abortUpstream(reason);
      return reader.cancel(reason);
    },
  }, { highWaterMark: 0 });
}

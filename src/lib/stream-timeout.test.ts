import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamWithIdleTimeout } from './stream-timeout';

afterEach(() => vi.useRealTimers());

describe('streamWithIdleTimeout', () => {
  it('allows a progressing transfer to outlive the timeout', async () => {
    vi.useFakeTimers();
    let source!: ReadableStreamDefaultController<Uint8Array>;
    const abort = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(c) { source = c; } });
    const reader = streamWithIdleTimeout(body, 8000, abort).getReader();
    for (let i = 0; i < 4; i++) {
      const pending = reader.read();
      await vi.advanceTimersByTimeAsync(4000);
      source.enqueue(new Uint8Array([i]));
      expect((await pending).value).toEqual(new Uint8Array([i]));
    }
    source.close();
    expect((await reader.read()).done).toBe(true);
    expect(abort).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts and cancels upstream when no next chunk arrives', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(); const abort = vi.fn();
    const reader = streamWithIdleTimeout(new ReadableStream({ cancel }), 8000, abort).getReader();
    const pending = expect(reader.read()).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(8001);
    await pending;
    expect(abort).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not time out while the client is not asking for more data', async () => {
    vi.useFakeTimers();
    const abort = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([1])); } });
    const reader = streamWithIdleTimeout(body, 8000, abort).getReader();
    await reader.read();
    await vi.advanceTimersByTimeAsync(30000);
    expect(abort).not.toHaveBeenCalled();
    await reader.cancel('seek');
    expect(abort).toHaveBeenCalledWith('seek');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans up a pending read when the downstream cancels', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(); const abort = vi.fn();
    const reader = streamWithIdleTimeout(new ReadableStream({ cancel }), 8000, abort).getReader();
    const pending = reader.read();
    await vi.advanceTimersByTimeAsync(100);
    await reader.cancel('new position');
    expect((await pending).done).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    expect(abort).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});

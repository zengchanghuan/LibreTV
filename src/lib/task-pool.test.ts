import { expect, it, vi } from 'vitest';
import { createTaskPool } from './task-pool';

it('caps active background tasks and removes cancelled work from the queue', async () => {
  const run = createTaskPool(2), signal = new AbortController().signal;
  const finish: (() => void)[] = [];
  let active = 0, max = 0;
  const task = () => new Promise<void>(resolve => {
    active++; max = Math.max(max, active);
    finish.push(() => { active--; resolve(); });
  });
  const first = run(task, signal), second = run(task, signal);
  const cancelled = new AbortController(), never = vi.fn(task);
  const queued = run(never, cancelled.signal).catch(error => error);
  const fourth = run(task, signal);
  await Promise.resolve();
  expect(active).toBe(2);
  cancelled.abort(); finish.shift()!();
  await first; await new Promise(resolve => setTimeout(resolve, 0));
  expect(active).toBe(2); expect(never).not.toHaveBeenCalled();
  while (finish.length) finish.shift()!();
  await Promise.all([second, queued, fourth]); expect(max).toBe(2);
});

it('releases a slot after failures and skips tasks cancelled before entering the pool', async () => {
  const run = createTaskPool(1), controller = new AbortController();
  const failed = run(async () => { throw new Error('failed'); }, controller.signal).catch(error => error);
  const next = run(async () => 'ok', controller.signal);
  expect(await next).toBe('ok'); await failed;
  controller.abort(); const task = vi.fn();
  await expect(run(task, controller.signal)).rejects.toThrow(); expect(task).not.toHaveBeenCalled();
});

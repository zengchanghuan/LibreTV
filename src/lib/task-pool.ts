/** Limit background requests, including tasks still waiting when a page is left. */
export function createTaskPool(limit: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return function run<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      const cancelled = () => {
        const index = waiting.indexOf(start);
        if (index >= 0) waiting.splice(index, 1);
        reject(signal.reason);
      };
      const start = () => {
        signal.removeEventListener('abort', cancelled);
        if (signal.aborted) { reject(signal.reason); return; }
        active++;
        void Promise.resolve().then(task).then(resolve, reject).finally(() => {
          active--;
          waiting.shift()?.();
        });
      };
      if (signal.aborted) { reject(signal.reason); return; }
      if (active < limit) start();
      else { waiting.push(start); signal.addEventListener('abort', cancelled, { once: true }); }
    });
  };
}

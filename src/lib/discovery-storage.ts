import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const shared = globalThis as typeof globalThis & { homeDiscoveryQueues?: Map<string, Promise<unknown>> };
const queues = shared.homeDiscoveryQueues ??= new Map();
export function discoveryDirectory() { return join(process.env.LIBRETV_DATA_DIR || process.env.STATE_DIRECTORY?.split(':')[0] || join(process.cwd(), '.data'), 'discovery'); }
/** All writes run in the serving Node process, including the scheduler. */
export async function discoveryTransaction<T, R>(name: string, empty: () => T, action: (data: T) => R, write = false): Promise<R> {
  const file = join(discoveryDirectory(), `${name}.json`);
  const previous = queues.get(file) || Promise.resolve();
  const job = previous.catch(() => {}).then(async () => {
    let data: T;
    try { data = JSON.parse(await readFile(file, 'utf8')); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; data = empty(); }
    const result = action(data);
    if (write) {
      await mkdir(discoveryDirectory(), { recursive: true, mode: 0o700 });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try { await writeFile(temporary, JSON.stringify(data), { mode: 0o600, flag: 'wx' }); await rename(temporary, file); }
      finally { await unlink(temporary).catch(() => {}); }
    }
    return result;
  });
  queues.set(file, job);
  try { return await job; } finally { if (queues.get(file) === job) queues.delete(file); }
}

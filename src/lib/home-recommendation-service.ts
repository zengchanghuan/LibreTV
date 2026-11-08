import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deepSeekConfigured, deepSeekRecommendations } from './deepseek-recommendations';
import { buildHomeRecommendations, homeCatalogVersion, verifiedHomeAI } from './home-recommendations';
import { homeDay, type HomeRecommendations } from './home-discovery-types';
import type { RecommendedWork } from './recommendations';

interface Entry { data: HomeRecommendations; attempts: number; retryAt: number }
const cache = new Map<string, Entry>();
const pending = new Map<string, Promise<void>>();
const loading = new Map<string, Promise<Entry>>();
const cacheDir = () => process.env.HOME_RECOMMEND_CACHE_DIR || join(tmpdir(), 'hometv-home-recommendations');
const keyFor = (filter: boolean, now: number) => `${homeDay(now)}:${homeCatalogVersion}:${filter}`;
const pathFor = (filter: boolean) => join(cacheDir(), `daily-${filter ? 'filtered' : 'all'}.json`);

async function entryFor(filter: boolean, now: number): Promise<Entry> {
  const key = keyFor(filter, now);
  const hit = cache.get(key); if (hit) return hit;
  const inFlight = loading.get(key); if (inFlight) return inFlight;
  const task = (async () => {
    let entry: Entry | undefined;
    try {
      const saved = JSON.parse(await readFile(pathFor(filter), 'utf8')) as Entry;
      if (saved.data?.day === homeDay(now) && saved.data.version === homeCatalogVersion
        && ['ready', 'fallback'].includes(saved.data.aiStatus) && Array.isArray(saved.data.batches)
        && Number.isFinite(saved.retryAt) && Number.isFinite(saved.attempts)) entry = saved;
    } catch { /* A missing/unwritable disk cache never prevents local discovery. */ }
    entry ??= { data: buildHomeRecommendations(filter, [], now), attempts: 0, retryAt: 0 };
    // At most today's two visibility variants live in memory.
    for (const id of cache.keys()) if (!id.startsWith(homeDay(now))) cache.delete(id);
    cache.set(key, entry);
    return entry;
  })().finally(() => loading.delete(key));
  loading.set(key, task);
  return task;
}

export async function readHomeRecommendations(filter: boolean, now = Date.now()): Promise<HomeRecommendations> {
  const entry = await entryFor(filter, now);
  if (!deepSeekConfigured()) return { ...entry.data, aiStatus: entry.data.aiStatus === 'ready' ? 'ready' : 'disabled' };
  const canGenerate = entry.data.aiStatus !== 'ready' && entry.attempts < 2 && now >= entry.retryAt;
  return { ...entry.data, aiStatus: pending.has(keyFor(filter, now)) || canGenerate ? 'pending' : entry.data.aiStatus };
}

/** Run after sending the local response. One shared job, max 3 seeds and 2 attempts/day/filter. */
export async function warmHomeRecommendations(filter: boolean, now = Date.now()): Promise<void> {
  if (!deepSeekConfigured()) return;
  const key = keyFor(filter, now), entry = await entryFor(filter, now);
  if (pending.has(key)) return pending.get(key);
  if (entry.data.aiStatus === 'ready' || entry.attempts >= 2 || now < entry.retryAt) return;
  entry.attempts++;
  const job = (async () => {
    const groups: RecommendedWork[][] = [];
    // Select diverse seeds from today's deterministic pool, never a member's private history.
    const seeds = entry.data.batches.map(batch => batch.find(w => w.directors.length || w.genres.length)).filter((w): w is RecommendedWork => Boolean(w));
    for (const seed of seeds.slice(0, 3)) {
      try { groups.push(await deepSeekRecommendations(seed, filter, AbortSignal.timeout(28000))); }
      catch { /* Other seeds can still contribute; failed results are never trusted. */ }
    }
    const ai = Array.from({ length: 12 }, (_, i) => groups.flatMap(group => group[i] ? [group[i]] : [])).flat();
    const verified = verifiedHomeAI(ai, filter);
    entry.data = { ...buildHomeRecommendations(filter, verified, now), aiStatus: verified.length ? 'ready' : 'fallback' };
    entry.retryAt = Date.now() + 5 * 60_000;
    try {
      await mkdir(cacheDir(), { recursive: true, mode: 0o700 });
      const path = pathFor(filter), temporary = `${path}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(entry), { mode: 0o600 });
      await rename(temporary, path);
    } catch { /* In-memory cache still serves this process. */ }
  })().finally(() => pending.delete(key));
  pending.set(key, job);
  return job;
}

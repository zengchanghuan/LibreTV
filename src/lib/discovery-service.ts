import { createHash } from 'node:crypto';
import { detailSite, siteAdapterFor } from './site-adapters/site-adapters';
import { catalogIdentity } from './recommendation-catalog';
import { seedWork, workKey } from './recommendations';
import { isAdultContent } from './cms-parser';
import { fetchUpstream } from './fetch-utils';
import { cmsRequestHeaders } from './cms-parser';
import { checkUpstreamAllowed } from './ssrf';
import { getEnvSources } from './env-sources';
import { discoveryTransaction } from './discovery-storage';
import { DAY, emptyDiscovery, mergeDiscovery, parseDiscoveryItem, recentCards, sourceIdentity, visibleResources } from './discovery-catalog';
import { warmEditorialDraft } from './discovery-editorial-drafts';
import { publishedEditorial } from './discovery-editorial';
import { rankPopular, watchTransaction, pruneWatchState } from './discovery-popularity';
import type { DiscoveryResponse, DiscoveryWork } from './discovery-types';
import type { RecommendedWork } from './recommendations';
import { discoveryDirectory } from './discovery-storage';
import type { SourceConfig } from './types';
import type { HomePreference } from './home-feedback-types';
import { homePreferenceFilter } from './home-preferences';

const shared = globalThis as typeof globalThis & { discoveryRefresh?: Promise<void>; discoveryTimer?: ReturnType<typeof setInterval>; discoveryLastAttempt?: number; discoveryPopular?: Map<string, RecommendedWork[]> };
export function discoverySources() { return getEnvSources().filter(s => !s.isAdult && /\/provide\/vod(?:\/|$|\?)/.test(s.url)).slice(0, 20); }
async function readSource(source: SourceConfig, params: Record<string, string>) {
  const verdict = await checkUpstreamAllowed(source.url); if (!verdict.ok) throw new Error('不可用来源');
  const url = new URL(source.url); for (const key of ['ac', 'ids', 'wd', 'pg', 't']) url.searchParams.delete(key);
  url.searchParams.set('ac', 'videolist'); Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const response = await fetchUpstream(url.href, { headers: cmsRequestHeaders(), timeoutMs: 8000 });
  if (!response.ok) { await response.body?.cancel(); throw new Error('来源暂不可用'); }
  const body = await response.json() as { list?: unknown[] };
  if (!Array.isArray(body.list)) throw new Error('来源格式不正确');
  return body.list.slice(0, 100).filter((v): v is Record<string, unknown> => Boolean(v && typeof v === 'object'));
}
export async function refreshDiscovery(force = false) {
  if (process.env.HOME_DISCOVERY_RECENT === '0' && process.env.HOME_DISCOVERY_POPULAR === '0' && process.env.HOME_DISCOVERY_EDITORIAL === '0') return;
  if (shared.discoveryRefresh) return shared.discoveryRefresh;
  const now = Date.now();
  if (!force && shared.discoveryLastAttempt && now - shared.discoveryLastAttempt < 5 * 60_000) return;
  const job = (async () => {
    const before = await discoveryTransaction('catalog', emptyDiscovery, d => d);
    if (!force && now - before.attemptedAt < 30 * 60_000) return;
    shared.discoveryLastAttempt = now;
    const sources = discoverySources(), incoming: DiscoveryWork[] = [];
    let failures = 0, next = 0, successes = 0;
    await Promise.all(Array.from({ length: Math.min(3, sources.length) }, async () => {
      while (next < sources.length) {
        const source = sources[next++];
        for (let page = 1; page <= 2; page++) {
          try {
            const raw = await readSource(source, { pg: String(page) });
            if (page === 1) successes++;
            for (const row of raw) { const item = parseDiscoveryItem(row, source, now); if (item) incoming.push(item); }
          } catch { failures++; break; }
        }
      }
    }));
    await discoveryTransaction('catalog', emptyDiscovery, d => {
      d.works = mergeDiscovery(d.works, incoming, now); d.attemptedAt = now; d.failures = failures;
      if (successes && incoming.length) d.refreshedAt = now;
    }, true);
    await watchTransaction(d => pruneWatchState(d, now), true);
    if (process.env.HOME_DISCOVERY_EDITORIAL !== '0') await warmEditorialDraft();
  })().finally(() => { if (shared.discoveryRefresh === job) shared.discoveryRefresh = undefined; });
  shared.discoveryRefresh = job;
  return job;
}
export async function resolveObservedWork(sourceKey: string, vodId: string) {
  const source = getEnvSources().find(s => s.key === sourceKey && !s.isAdult); if (!source) return;
  const id = sourceIdentity(source.url);
  const known = await discoveryTransaction('catalog', emptyDiscovery, d => d.works.find(w => w.resources.some(r => r.sourceId === id && r.vodId === vodId)));
  if (known && known.resources.some(r => r.sourceId === id && Date.now() - r.observedAt < DAY)) return known.work;
  if (siteAdapterFor(source.url)) {
    if (!(await checkUpstreamAllowed(source.url)).ok) return;
    const detail = await detailSite(source, vodId, AbortSignal.timeout(10000));
    const seed = seedWork(detail.videoInfo), matched = catalogIdentity(seed);
    const work = { ...seed, ...(matched || {}), id: matched?.id || `discovery:${createHash('sha256').update(workKey(seed)).digest('hex').slice(0, 24)}` };
    if (!work.title || !/^(18|19|20)\d{2}$/.test(work.year) || !detail.episodes.length || isAdultContent(detail.videoInfo.typeName) || /情色|解说|预告/.test(work.title + work.genres.join(','))) return;
    const now = Date.now();
    const item: DiscoveryWork = { work, firstSeenAt: now, resources: [{ sourceId: id, sourceKey, vodId, firstSeenAt: now, observedAt: now, episodeCount: detail.episodes.length, episodes: detail.episodes.map(url => createHash('sha256').update(url).digest('hex').slice(0, 16)) }] };
    await discoveryTransaction('catalog', emptyDiscovery, d => { d.works = mergeDiscovery(d.works, [item], now); }, true);
    return work;
  }
  const raw = (await readSource(source, { ids: vodId })).find(r => String(r.vod_id) === vodId);
  const item = raw && parseDiscoveryItem(raw, source, Date.now()); if (!item) return;
  await discoveryTransaction('catalog', emptyDiscovery, d => { d.works = mergeDiscovery(d.works, [item], Date.now()); }, true);
  return item.work;
}
export async function readDiscovery(sourceKeys: string[], now = Date.now(), preferences: HomePreference[] = []): Promise<DiscoveryResponse> {
  const sources = new Set(getEnvSources().filter(s => !s.isAdult && sourceKeys.includes(s.key)).map(s => sourceIdentity(s.url)));
  let catalogFailed = false;
  const store = await discoveryTransaction('catalog', emptyDiscovery, d => d).catch(() => { catalogFailed = true; return emptyDiscovery(); });
  const enabled = { recent: process.env.HOME_DISCOVERY_RECENT !== '0', popular: process.env.HOME_DISCOVERY_POPULAR !== '0', editorial: process.env.HOME_DISCOVERY_EDITORIAL !== '0' };
  const allowed = homePreferenceFilter(preferences);
  // Filter the full source catalog before the 48-card cap, so refill cannot bring rejected formats back.
  const recent = enabled.recent ? recentCards(store.works.filter(entry => allowed(entry.work)), sources, now) : { new: [], series: [], added: [] };
  const works = store.works.filter(w => visibleResources(w, sources, now).length).map(w => w.work);
  let popularityFailed = false;
  const hour = Math.floor(now / 3600_000), cacheKey = JSON.stringify([hour, discoveryDirectory(), [...sources].sort()]);
  const snapshots = shared.discoveryPopular ??= new Map<string, RecommendedWork[]>();
  for (const key of snapshots.keys()) if (!key.startsWith(`[${hour},`)) snapshots.delete(key);
  let popular: RecommendedWork[] = [];
  if (enabled.popular) {
    const cached = snapshots.get(cacheKey);
    if (cached) popular = cached.filter(w => works.some(item => item.id === w.id));
    else {
      popular = await watchTransaction(d => rankPopular(d, works, now)).catch(() => { popularityFailed = true; return []; });
      if (!popularityFailed) { if (snapshots.size >= 32) snapshots.delete(snapshots.keys().next().value!); snapshots.set(cacheKey, popular); }
    }
  }
  return { recent, refreshedAt: store.refreshedAt ? new Date(store.refreshedAt).toISOString() : null,
    stale: Boolean(store.refreshedAt && now - store.refreshedAt > 30 * 60_000), partial: catalogFailed || store.failures > 0,
    loading: !store.refreshedAt && Boolean(shared.discoveryRefresh), popular,
    popularStatus: !enabled.popular ? 'disabled' : popularityFailed ? 'unavailable' : popular.length ? 'ready' : 'collecting',
    editorial: enabled.editorial ? publishedEditorial(now) : [], enabled };
}
/** One scheduler in the serving process; timers do not run during next build. */
export function startDiscoveryScheduler() {
  if (shared.discoveryTimer || process.env.NEXT_PHASE === 'phase-production-build' || process.env.HOME_DISCOVERY_SCHEDULER === '0') return;
  shared.discoveryTimer = setInterval(() => { void refreshDiscovery().catch(() => console.warn('[HomeTV] discovery refresh failed')); }, 60_000);
  shared.discoveryTimer.unref();
}
export { DAY };

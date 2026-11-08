import { createHash } from 'node:crypto';
import { isAdultContent, extractEpisodesFromPlayUrl } from './cms-parser';
import { classifyMediaType } from './media-type';
import { filmPosterUrl } from './film-card-metadata';
import { catalogIdentity } from './recommendation-catalog';
import { seedWork, resourceTitleKey } from './recommendations';
import type { SourceConfig } from './types';
import type { DiscoveryResource, DiscoveryStore, DiscoveryWork, RecentCard, RecentTab } from './discovery-types';

export const DAY = 86400_000;
export const emptyDiscovery = (): DiscoveryStore => ({ version: 1, refreshedAt: 0, attemptedAt: 0, failures: 0, works: [] });
export function sourceIdentity(url: string) { return createHash('sha256').update(url.replace(/\/+$/, '')).digest('hex').slice(0, 20); }
const clean = (x: unknown, max = 200) => typeof x === 'string' ? x.replace(/<[^>]*>/g, '').trim().slice(0, max) : '';
const currentYear = (now: number) => new Date(now + 8 * 3600_000).getUTCFullYear();
/** Only explicit, valid calendar dates. A year and an ingestion timestamp are not release dates. */
export function calendarDate(value: unknown, now: number): string | undefined {
  if (typeof value !== 'string') return;
  const date = value.match(/^(\d{4})[-/]([01]?\d)[-/]([0-3]?\d)(?:\s|$|[（(T])/);
  if (!date) return;
  const ymd = `${date[1]}-${date[2].padStart(2, '0')}-${date[3].padStart(2, '0')}`;
  const time = Date.parse(`${ymd}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== ymd || time > now + 8 * 3600_000) return;
  return ymd;
}
export function parseDiscoveryItem(raw: Record<string, unknown>, source: SourceConfig, now: number): DiscoveryWork | undefined {
  const title = clean(raw.vod_name, 100), typeName = clean(raw.type_name);
  const year = String(raw.vod_year || '').match(/^(18|19|20)\d{2}$/)?.[0];
  const vodId = typeof raw.vod_id === 'number' || typeof raw.vod_id === 'string' ? String(raw.vod_id).slice(0, 100) : '';
  if (!title || !vodId || !year || Number(year) > currentYear(now) || source.isAdult || isAdultContent(title + ',' + typeName) || /情色|解说|解說|预告|預告|花絮|幕后/.test(title + typeName)) return;
  const mediaType = classifyMediaType(typeName);
  if (mediaType === 'unknown') return;
  const seed = seedWork({ title, year, typeName, cover: filmPosterUrl(clean(raw.vod_pic, 4096), source.url),
    director: clean(raw.vod_director), actor: clean(raw.vod_actor), sourceKey: source.key, sourceName: source.name });
  const known = catalogIdentity(seed);
  // TV identities require a matching season/title, not just a third-party subject ID.
  const work = { ...seed, ...(known || {}), mediaType, id: known?.id || `discovery:${createHash('sha256').update(JSON.stringify([resourceTitleKey(title), year, mediaType])).digest('hex').slice(0, 24)}` };
  work.metadata = { ...work.metadata, genre: work.metadata?.genre || typeName, area: clean(raw.vod_area),
    intro: work.metadata?.intro || clean(raw.vod_content, 1200), poster: work.poster };
  const episodes = [...new Set(extractEpisodesFromPlayUrl(String(raw.vod_play_url || ''))
    .map(url => createHash('sha256').update(url).digest('hex').slice(0, 16)))].slice(0, 1000);
  // No resource entry without actual episodes. List-only search hits do not promise playback.
  if (!episodes.length) return;
  const releaseDate = calendarDate(raw.vod_pubdate, now);
  const updated = calendarDate(raw.vod_time, now);
  return { work, firstSeenAt: now, resources: [{ sourceId: sourceIdentity(source.url), sourceKey: source.key, vodId, observedAt: now, firstSeenAt: now,
    updatedAt: updated ? Date.parse(updated + 'T00:00:00+08:00') : undefined,
    releaseDate, releaseEvidence: releaseDate ? `${source.url}#vod=${encodeURIComponent(vodId)}:vod_pubdate` : undefined,
    episodes, episodeCount: episodes.length }] };
}
export function mergeDiscovery(previous: DiscoveryWork[], incoming: DiscoveryWork[], now: number): DiscoveryWork[] {
  const map = new Map(previous.map(w => [w.work.id, structuredClone(w)]));
  for (const item of incoming) {
    const old = map.get(item.work.id);
    if (!old) { map.set(item.work.id, item); continue; }
    old.work = { ...old.work, ...item.work };
    for (const resource of item.resources) {
      const index = old.resources.findIndex(r => r.sourceId === resource.sourceId && r.vodId === resource.vodId), before = old.resources[index];
      // A changed URL alone is not a new episode: require a strictly larger episode list.
      const extended = before && resource.episodeCount > before.episodeCount;
      const next = { ...resource, firstSeenAt: before?.firstSeenAt ?? now,
        episodeCount: Math.max(resource.episodeCount, before?.episodeCount || 0),
        lastEpisodeAt: extended ? now : before?.lastEpisodeAt };
      if (index >= 0) old.resources[index] = next; else old.resources.push(next);
    }
  }
  return [...map.values()].map(w => ({ ...w, resources: w.resources.filter(r => now - r.observedAt < 30 * DAY) }))
    .filter(w => w.resources.length).sort((a, b) => Math.max(...b.resources.map(r => r.observedAt)) - Math.max(...a.resources.map(r => r.observedAt))).slice(0, 2000);
}
export function recentCards(works: DiscoveryWork[], allowedSources: Set<string>, now: number): Record<RecentTab, RecentCard[]> {
  const result: Record<RecentTab, { card: RecentCard; time: number; priority: number }[]> = { new: [], series: [], added: [] };
  for (const entry of works) {
    const resources = visibleResources(entry, allowedSources, now);
    if (!resources.length) continue;
    const count = new Set(resources.map(r => r.sourceId)).size;
    const add = (tab: RecentTab, time: number, label: string) => result[tab].push({ time, priority: ['movie', 'tv', 'documentary', 'animation', 'variety', 'short'].indexOf(entry.work.mediaType), card: { work: { ...entry.work, reasons: [label] }, sourceCount: count, date: new Date(time).toISOString(), label } });
    // Corroborate the exact date across two sources; conflicts exclude the movie from new releases.
    const dates = new Map<string, Set<string>>();
    for (const r of resources) if (r.releaseDate) { const ids = dates.get(r.releaseDate) || new Set(); ids.add(r.sourceId); dates.set(r.releaseDate, ids); }
    if (['movie', 'documentary'].includes(entry.work.mediaType) && dates.size === 1) {
      const [date, ids] = [...dates][0], released = Date.parse(date + 'T00:00:00+08:00');
      if (ids.size >= 2 && Number(date.slice(0, 4)) - Number(entry.work.year) >= 0 && Number(date.slice(0, 4)) - Number(entry.work.year) <= 1 && now - released <= 90 * DAY && now >= released) add('new', released, `${date} 上线 · 片源日期已交叉核对`);
    }
    if (['tv', 'variety', 'animation'].includes(entry.work.mediaType)) {
      const changed = resources.filter(r => r.lastEpisodeAt && now - r.lastEpisodeAt <= 7 * DAY);
      if (changed.length) add('series', Math.max(...changed.map(r => r.lastEpisodeAt!)), `更新至 ${Math.max(...changed.map(r => r.episodeCount))} 集`);
    }
    if (now - entry.firstSeenAt <= 30 * DAY) add('added', entry.firstSeenAt, '本站最近收录');
  }
  return Object.fromEntries(Object.entries(result).map(([tab, rows]) => [tab, rows.sort((a, b) => b.time - a.time || a.priority - b.priority || a.card.work.title.localeCompare(b.card.work.title)).slice(0, 48).map(r => r.card)])) as Record<RecentTab, RecentCard[]>;
}
export function visibleResources(entry: DiscoveryWork, sources: Set<string>, now: number): DiscoveryResource[] {
  if (Number(entry.work.year) > currentYear(now)) return [];
  return entry.resources.filter(r => sources.has(r.sourceId) && now - r.observedAt <= DAY);
}

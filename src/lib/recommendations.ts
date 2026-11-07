import { isAdultContent, searchTitleKey } from './cms-parser';
import { contentGenres, genreSimilarity, personTokens, sharedValues as intersection } from './content-similarity';
export { contentGenres, personTokens } from './content-similarity';
import { classifyMediaType, type MediaType } from './media-type';
import { relatedTitle, seriesQuery } from './related-videos';
import type { SearchResultItem, VideoInfo } from './types';
import type { FilmPosterMetadata } from './film-poster-metadata';

/** A work has no playback source or vodId. Those belong to a separately resolved resource. */
export interface RecommendedWork {
  id: string;
  title: string;
  aliases: string[];
  year: string;
  mediaType: MediaType;
  poster?: string;
  metadata?: FilmPosterMetadata;
  genres: string[];
  directors: string[];
  cast: string[];
  score: number;
  reasons: string[];
  origin: 'catalog' | 'ai' | 'source';
  aiReason?: string;
}
export interface RecommendationResponse {
  items: RecommendedWork[];
  provider: 'local' | 'deepseek';
  aiAvailable?: boolean;
  partial?: boolean;
}
export interface ResourceMatch extends SearchResultItem {
  metadata?: FilmPosterMetadata;
  /** Missing classification stays visible rather than being invented from a genre. */
  typeUnconfirmed?: boolean;
}
export interface WorkResourcesResponse {
  items: ResourceMatch[];
  checked: number;
  failures: { sourceKey: string; error: string }[];
}

export function seedWork(info: VideoInfo): RecommendedWork {
  const title = (info.title || '').trim();
  return { id: `seed:${title}:${info.year || ''}`, title, aliases: [], year: info.year || '',
    mediaType: classifyMediaType(info.typeName), poster: info.cover, genres: contentGenres(info.typeName),
    directors: personTokens(info.director), cast: personTokens(info.actor).slice(0, 5), score: 0, reasons: [], origin: 'source' };
}

export function workKey(work: Pick<RecommendedWork, 'title' | 'year' | 'mediaType'>) {
  return JSON.stringify([resourceTitleKey(work.title), work.year, work.mediaType]);
}
export function resourceTitleKey(title: string) {
  const clean = title.replace(/(?:\s*[（(\[【]?(?:国语|粤语|普通话|英语|日语|韩语|中字|中文|中英双字|双语|原声|高清|蓝光|超清|修复|加长|未删减|4k|1080p|720p|HD|BD)(?:版)?[）)\]】]?)+\s*$/gi, '');
  return searchTitleKey(clean);
}

/** Unknown years are not silently attached to one of several same-name remakes. */
export function matchesWorkTitle(work: Pick<RecommendedWork, 'title' | 'aliases'>, title: string) {
  const key = resourceTitleKey(title);
  return [work.title, ...work.aliases].some(name => resourceTitleKey(name) === key);
}
export function resourceMatch(work: RecommendedWork, item: SearchResultItem): 'match' | 'detail' | 'reject' {
  if (/解说|解說|预告|預告|花絮|幕后|幕後/.test(item.name + (item.typeName || '')) || !matchesWorkTitle(work, item.name)) return 'reject';
  const kind = classifyMediaType(item.typeName);
  if (kind !== 'unknown' && work.mediaType !== 'unknown' && kind !== work.mediaType) return 'reject';
  const year = item.year?.match(/\b(?:18|19|20)\d{2}\b/)?.[0];
  if (!year || !work.year) return 'detail';
  return year === work.year ? 'match' : 'reject';
}

export function rankWorks(seed: RecommendedWork, candidates: RecommendedWork[], filterAdult = true): RecommendedWork[] {
  const dedup = new Map<string, RecommendedWork>();
  for (const item of candidates) {
    if (!item.title || matchesWorkTitle(seed, item.title) || item.id === seed.id) continue;
    if (seed.mediaType !== 'unknown' && item.mediaType !== 'unknown' && seed.mediaType !== item.mediaType) continue;
    if (filterAdult && isAdultContent(item.genres.join(',') + (item.genres.includes('情色') ? ',伦理片' : ''))) continue;
    const directors = intersection(seed.directors, item.directors);
    const cast = intersection(seed.cast.slice(0, 5), item.cast.slice(0, 5));
    const { specific, score: genreScore } = genreSimilarity(seed.genres, item.genres);
    const a = seriesQuery(seed.title), b = seriesQuery(item.title);
    const series = Boolean(a && b && relatedTitle(a) === relatedTitle(b));
    const reasons: string[] = [];
    let score = item.origin === 'ai' ? Math.min(50, Math.max(30, item.score)) : 0;
    if (series) { score += 70; reasons.push('相近系列片名'); }
    if (directors.length) { score += 60; reasons.push(`同导演 · ${directors[0]}`); }
    if (cast.length) { score += Math.min(30, cast.length * 15); reasons.push(`共同演员 · ${cast[0]}`); }
    // One generic label (or country/format label) can never create a recommendation.
    if (!series && !directors.length && item.origin !== 'ai'
      && !(cast.length && (specific.length || cast.length >= 2)) && specific.length < 2) continue;
    score += genreScore;
    if (specific.length >= 2) reasons.push(`相近题材 · ${specific.slice(0, 2).join(' / ')}`);
    if (item.aiReason) reasons.push(`AI 推荐 · ${item.aiReason}`);
    if (!reasons.length) continue;
    const value = { ...item, score, reasons: reasons.slice(0, 2) };
    const key = item.id.startsWith('local:') ? item.id : workKey(item), previous = dedup.get(key);
    if (!previous || previous.score < score) dedup.set(key, value);
  }
  return [...dedup.values()].sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'zh-Hans-CN')).slice(0, 12);
}

/** Runtime validation is shared by the two authenticated POST endpoints. */
export function readWork(value: unknown): RecommendedWork | undefined {
  if (!value || typeof value !== 'object') return;
  const v = value as Partial<RecommendedWork>;
  if (typeof v.title !== 'string' || !v.title.trim() || v.title.length > 100
    || typeof v.year !== 'string' || !/^(18|19|20)\d{2}$/.test(v.year)
    || !['movie', 'tv', 'short', 'animation', 'variety', 'documentary', 'unknown'].includes(v.mediaType || '')) return;
  const strings = (a: unknown) => Array.isArray(a) ? a.filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length <= 100).slice(0, 5) : [];
  return { id: typeof v.id === 'string' ? v.id.slice(0, 200) : workKey(v as RecommendedWork), title: v.title.trim(), year: v.year,
    mediaType: v.mediaType!, aliases: strings(v.aliases), genres: strings(v.genres), directors: strings(v.directors), cast: strings(v.cast),
    score: 0, reasons: [], origin: 'source' };
}

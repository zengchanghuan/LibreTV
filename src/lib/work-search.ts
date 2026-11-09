import { prepareSearchResults, searchTitleKey } from './cms-parser';
import { classifyMediaType, type MediaType } from './media-type';
import type { SearchResultItem } from './types';
import { getWork, isDerivativeTitle, resolveWork, workSearchTitles, workTitleKey, type CatalogWork } from './work-catalog';

export interface SearchContext {
  workId?: string;
  year?: string;
  mediaType?: MediaType;
  doubanId?: string;
}

export interface SearchPlan {
  query: string;
  titles: string[];
  work?: CatalogWork;
  context: SearchContext;
  strict: boolean;
}

export type PickFilm = (title: string, context?: SearchContext) => void;
const mediaTypes: MediaType[] = ['movie', 'tv', 'short', 'animation', 'variety', 'documentary', 'unknown'];

export function readSearchContext(value: unknown): SearchContext | undefined {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) return;
  const v = value as Record<string, unknown>;
  if (v.workId !== undefined && (typeof v.workId !== 'string' || v.workId.length > 200 || !getWork(v.workId))) return;
  if (v.year !== undefined && (typeof v.year !== 'string' || !/^(18|19|20)\d{2}$/.test(v.year))) return;
  if (v.mediaType !== undefined && !mediaTypes.includes(v.mediaType as MediaType)) return;
  if (v.doubanId !== undefined && (typeof v.doubanId !== 'string' || !/^\d{1,12}$/.test(v.doubanId))) return;
  const context = { workId: v.workId, year: v.year, mediaType: v.mediaType, doubanId: v.doubanId } as SearchContext;
  const work = context.workId ? getWork(context.workId) : undefined;
  if (work && ((context.year && context.year !== work.year)
    || (context.mediaType && context.mediaType !== 'unknown' && work.mediaType !== 'unknown' && context.mediaType !== work.mediaType)
    || (context.doubanId && !work.doubanIds.includes(context.doubanId)))) return;
  return context;
}

export function contextForFilm(title: string, year?: string | number, mediaType?: MediaType, doubanId?: string): SearchContext {
  const work = resolveWork(title, year, mediaType, doubanId);
  return {
    ...(work ? { workId: work.id } : {}),
    ...(year || work?.year ? { year: String(year || work?.year) } : {}),
    ...(mediaType || work?.mediaType ? { mediaType: mediaType || work?.mediaType } : {}),
    ...(doubanId ? { doubanId } : {}),
  };
}

export function contextFromParams(params: Pick<URLSearchParams, 'get'>): SearchContext {
  return readSearchContext(Object.fromEntries(['workId', 'year', 'mediaType', 'doubanId']
    .flatMap(key => params.get(key) ? [[key, params.get(key)]] : []))) || {};
}

export function buildSearchPlan(query: string, context: SearchContext = {}): SearchPlan {
  const work = context.workId ? getWork(context.workId) : resolveWork(query, context.year, context.mediaType, context.doubanId);
  return { query, work, context, strict: Boolean(context.workId || context.year || context.mediaType || context.doubanId),
    titles: work ? workSearchTitles(work, query) : [query] };
}

export function resultYear(year?: string) {
  return year?.match(/\b(?:18|19|20)\d{2}\b/)?.[0];
}

/** Never infer identity from a shared title alone, nor from missing year/type fields. */
export function workResultStatus(item: SearchResultItem, plan: SearchPlan): 'match' | 'unconfirmed' | 'reject' {
  if (!plan.strict) return 'match';
  if (isDerivativeTitle(item.name + (item.typeName || ''))) return 'reject';
  if (plan.work && ![plan.work.title, ...plan.work.aliases].some(name => workTitleKey(name) === workTitleKey(item.name))) return 'reject';
  const year = resultYear(item.year), kind = classifyMediaType(item.typeName);
  const expectedYear = plan.context.year || plan.work?.year;
  const expectedType = plan.context.mediaType && plan.context.mediaType !== 'unknown' ? plan.context.mediaType : plan.work?.mediaType;
  if ((year && expectedYear && year !== expectedYear)
    || (kind !== 'unknown' && expectedType && expectedType !== 'unknown' && kind !== expectedType)) return 'reject';
  if (!year || !expectedYear || kind === 'unknown' || !expectedType || expectedType === 'unknown') return 'unconfirmed';
  return 'match';
}

/** Shared by source progress, final JSON/NDJSON, and client incremental rendering. */
export function prepareWorkSearchResults(items: SearchResultItem[], plan: SearchPlan, filterAdult = true): SearchResultItem[] {
  if (filterAdult) items = items.filter(item => !item.isAdult && !/情色/.test(item.typeName || ''));
  const titles = plan.work ? [...new Set([plan.query, plan.work.title, ...plan.work.aliases])] : [plan.query];
  const matches = new Map<string, SearchResultItem>();
  for (const title of titles) for (const item of prepareSearchResults(items, title, filterAdult)) {
    const status = workResultStatus(item, plan);
    if (status === 'reject') continue;
    const key = JSON.stringify([item.sourceKey, item.vodId]);
    const year = resultYear(item.year), mediaType = classifyMediaType(item.typeName);
    const known = !isDerivativeTitle(item.name + (item.typeName || '')) && year && mediaType !== 'unknown'
      ? resolveWork(item.name, year, mediaType) : undefined;
    const confirmed = known && known.mediaType !== 'unknown' && known.mediaType === mediaType ? known : undefined;
    matches.set(key, { ...item, workId: confirmed?.id, identityUnconfirmed: status === 'unconfirmed' || undefined });
  }
  const exact = new Set(titles.map(searchTitleKey));
  const score = (item: SearchResultItem) => Number(Boolean(item.identityUnconfirmed)) * 20
    + Number(isDerivativeTitle(item.name + (item.typeName || ''))) * 10
    + (exact.has(searchTitleKey(item.name)) ? 0 : 1);
  return [...matches.values()].sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name, 'zh-Hans-CN') || a.sourceName.localeCompare(b.sourceName, 'zh-Hans-CN'));
}

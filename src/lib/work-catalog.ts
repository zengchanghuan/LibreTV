import metadataData from './film-poster-data.json';
import titleData from './work-title-data.json';
import grandSlamData from './korean-grand-slam-data.json';
import type { FilmPosterMetadata } from './film-poster-metadata';
import type { MediaType } from './media-type';
import { searchTitleKey } from './cms-parser';

export interface CatalogWork {
  id: string;
  title: string;
  aliases: string[];
  year: string;
  mediaType: MediaType;
  metadataKeys: string[];
  metadata: FilmPosterMetadata;
  doubanIds: string[];
}

export interface WorkTitleRecord {
  id: string;
  title: string;
  year: number;
  mediaType: 'movie' | 'tv';
  originalTitle: string;
  aliases: string[];
  metadataKeys: string[];
}

/** Edition/language suffixes are not separate works; sequel numbers are never removed. */
export function workTitleKey(title: string) {
  return searchTitleKey(title.normalize('NFKC').replace(/(?:\s*[（(\[【]?(?:国语|粤语|普通话|英语|日语|韩语|中字|中文|中英双字|双语|原声|高清|蓝光|超清|修复|加长|未删减|4k|1080p|720p|HD|BD)(?:版)?[）)\]】]?)+\s*$/gi, ''));
}

export const isDerivativeTitle = (title: string) => /解说|解說|预告|預告|花絮|幕后|幕後/.test(title);

function legacyIdentity(key: string, meta: FilmPosterMetadata) {
  const year = key.slice(key.lastIndexOf('|') + 1);
  const subject = meta.doubanId || meta.source?.match(/movie\.douban\.com\/subject\/(\d+)/)?.[1];
  const tmdb = meta.source?.match(/themoviedb\.org\/(movie|tv)\/(\d+)/);
  const imdb = meta.source?.match(/imdb\.com\/title\/(tt\d+)/)?.[1];
  return subject ? `douban:${subject}:${year}` : tmdb ? `tmdb:${tmdb[1]}:${tmdb[2]}:${year}` : imdb ? `imdb:${imdb}:${year}` : `title:${key}`;
}

export function createWorkCatalog(metadata: Record<string, FilmPosterMetadata>, records: WorkTitleRecord[]) {
  const mappedKeys = new Map(records.flatMap(work => work.metadataKeys.map(key => [key, work] as const)));
  const byId = new Map<string, CatalogWork>();
  const legacyIds = new Map<string, string | undefined>();
  const allKeys = new Set([...Object.keys(metadata), ...mappedKeys.keys()]);
  for (const key of allKeys) {
    const meta = metadata[key] || {}, at = key.lastIndexOf('|'), title = key.slice(0, at), year = key.slice(at + 1);
    const legacyId = legacyIdentity(key, meta);
    const collected = mappedKeys.get(key);
    const subject = meta.doubanId || meta.source?.match(/movie\.douban\.com\/subject\/(\d+)/)?.[1];
    const tmdb = meta.source?.match(/themoviedb\.org\/(movie|tv)\/(\d+)/);
    // Poster/source citations are not verified identity links. Only collected evidence merges names.
    const id = collected?.id || `title:${key}`;
    legacyIds.set(legacyId, legacyIds.has(legacyId) && legacyIds.get(legacyId) !== id ? undefined : id);
    legacyIds.set(`title:${key}`, id);
    const previous = byId.get(id);
    const work: CatalogWork = previous || {
      id, title: collected?.title || title, year, aliases: [], metadataKeys: [], metadata: {}, doubanIds: [],
      mediaType: collected?.mediaType || meta.mediaType || (tmdb?.[1] as MediaType) || 'unknown',
    };
    // Preserve editorial metadata; a title refresh never replaces ratings or posters.
    for (const [field, value] of Object.entries(meta)) {
      if (value && !work.metadata[field as keyof FilmPosterMetadata]) Object.assign(work.metadata, { [field]: value });
    }
    work.metadataKeys.push(key);
    work.aliases = [...new Set([...work.aliases, title, ...collected?.aliases || []])].filter(name => name !== work.title);
    if (subject && !work.doubanIds.includes(subject)) work.doubanIds.push(subject);
    byId.set(id, work);
  }
  const byTitle = new Map<string, CatalogWork[]>();
  for (const work of byId.values()) for (const name of new Set([work.title, ...work.aliases].map(workTitleKey))) {
    const hits = byTitle.get(name) || [];
    hits.push(work); byTitle.set(name, hits);
  }
  const resolve = (title: string, year?: string | number, mediaType?: MediaType, doubanId?: string) => {
    const hits = (doubanId ? [...new Set(byId.values())].filter(w => w.doubanIds.includes(doubanId)) : byTitle.get(workTitleKey(title)) || [])
      .filter(w => (!year || w.year === String(year)) && (!mediaType || mediaType === 'unknown' || w.mediaType === 'unknown' || mediaType === w.mediaType));
    return hits.length === 1 ? hits[0] : undefined;
  };
  const works = [...byId.values()];
  for (const [legacy, canonical] of legacyIds) if (canonical && !byId.has(legacy)) byId.set(legacy, byId.get(canonical)!);
  return { works, byId, resolve };
}

// Curated award films participate in the same identity/alias search as other collections.
// Preserve existing canonical IDs so saved feedback and history still identify the same work.
const catalogMetadata = { ...metadataData } as Record<string, FilmPosterMetadata>;
const catalogTitles: WorkTitleRecord[] = titleData.works.map(work => ({ ...work,
  aliases: [...work.aliases], metadataKeys: [...work.metadataKeys],
})) as WorkTitleRecord[];
for (const film of grandSlamData.films) {
  const key = `${film.title}|${film.year}`;
  const names = new Set([film.title, ...film.aliases].map(workTitleKey));
  const matches = catalogTitles.filter(work => work.year === film.year && work.mediaType === 'movie'
    && [work.title, ...work.aliases, ...work.metadataKeys.map(key => key.slice(0, key.lastIndexOf('|')))]
      .some(name => names.has(workTitleKey(name))));
  const previous = matches.length === 1 ? matches[0] : undefined;
  catalogMetadata[key] = { ...catalogMetadata[key], ...film.metadata, mediaType: 'movie' };
  if (previous) {
    previous.metadataKeys = [...new Set([...previous.metadataKeys, key])];
    previous.aliases = [...new Set([...previous.aliases, film.title, ...film.aliases])];
  } else {
    catalogTitles.push({ id: film.id, title: film.title, year: film.year, mediaType: 'movie',
      originalTitle: film.referenceTitle, aliases: film.aliases, metadataKeys: [key] });
  }
}
export const workCatalog = createWorkCatalog(catalogMetadata, catalogTitles);
export const resolveWork = workCatalog.resolve;
export const getWork = (id: string) => workCatalog.byId.get(id);

/** Primary + queried/list name; use another alias when those are identical. */
export function workSearchTitles(work: CatalogWork, query: string): string[] {
  const candidates = [work.title, query, ...work.metadataKeys.map(key => key.slice(0, key.lastIndexOf('|'))),
    ...work.aliases.filter(name => /[\u3400-\u9fff]/.test(name)), ...work.aliases];
  const seen = new Set<string>();
  return candidates.filter(title => {
    const key = workTitleKey(title);
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, 2);
}

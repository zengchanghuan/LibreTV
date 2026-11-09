import { workCatalog, workTitleKey } from './work-catalog';
import originalMetadata from './film-poster-data.json';
import type { FilmPosterMetadata } from './film-poster-metadata';
import { peopleCollections } from './people-collections';
import { contentGenres, matchesWorkTitle, personTokens, rankWorks, seedWork, type RecommendedWork } from './recommendations';
import type { VideoInfo } from './types';

const credits = new Map<string, { directors: string[]; cast: string[] }>();
// Keep persisted feedback/resource IDs stable when TMDB supplies a better display title.
function persistedId(key: string) {
  const meta = (originalMetadata as Record<string, FilmPosterMetadata>)[key] || {};
  const year = key.slice(key.lastIndexOf('|') + 1);
  const subject = meta.doubanId || meta.source?.match(/movie\.douban\.com\/subject\/(\d+)/)?.[1];
  const tmdb = meta.source?.match(/themoviedb\.org\/(movie|tv)\/(\d+)/);
  return `local:${subject ? `douban:${subject}:${year}` : tmdb ? `tmdb:${tmdb[1]}:${tmdb[2]}:${year}` : key}`;
}
for (const person of peopleCollections) for (const section of person.sections) {
  const directing = person.role === 'director' || (person.role === 'both' && /^(导演|执导|自导)/.test(section.label));
  for (const [title, year] of section.films) {
    const key = `${title}|${year}`, value = credits.get(key) || { directors: [], cast: [] };
    (directing ? value.directors : value.cast).push(person.fullName || person.name);
    credits.set(key, value);
  }
}
const legacyOwners = new Map<string, Set<string>>();
for (const work of workCatalog.works) for (const key of work.metadataKeys) {
  const id = persistedId(key);
  const owners = legacyOwners.get(id) || new Set<string>();
  owners.add(work.id); legacyOwners.set(id, owners);
}
export const recommendationCatalog: RecommendedWork[] = workCatalog.works.map(work => {
  const { title, year, aliases, metadata: meta, mediaType } = work;
  const people = work.metadataKeys.map(key => credits.get(key)).filter(value => value !== undefined);
  const directors = [...new Set([...personTokens(meta.director), ...people.flatMap(p => p.directors)])];
  const cast = [...new Set([...personTokens(meta.cast), ...people.flatMap(p => p.cast)])];
  const oldId = persistedId(work.metadataKeys[0]);
  return { id: legacyOwners.get(oldId)!.size === 1 ? oldId : `local:work:${work.id}`, title, year, aliases, mediaType,
    metadata: { ...meta, director: meta.director || directors.join(' / '), cast: meta.cast || cast.join(' / ') },
    poster: meta.poster, genres: contentGenres(meta.genre), directors,
    cast: cast.slice(0, 5), score: 0, reasons: [], origin: 'catalog' };
});

const byLegacyId = new Map<string, RecommendedWork>();
const byTitleYear = new Map<string, RecommendedWork[]>();
for (const [index, work] of recommendationCatalog.entries()) {
  byLegacyId.set(work.id, work);
  for (const key of workCatalog.works[index].metadataKeys) {
    const id = persistedId(key);
    if (legacyOwners.get(id)!.size === 1) byLegacyId.set(id, work);
  }
  for (const title of new Set([work.title, ...work.aliases].map(workTitleKey))) {
    const key = `${title}|${work.year}`;
    byTitleYear.set(key, [...byTitleYear.get(key) || [], work]);
  }
}
export const recommendationById = (id: string) => byLegacyId.get(id);
export function recommendationByTitle(title: string, year: string | number) {
  const hits = byTitleYear.get(`${workTitleKey(title)}|${year}`) || [];
  return hits.length === 1 ? hits[0] : undefined;
}

export function catalogIdentity(work: RecommendedWork): RecommendedWork | undefined {
  const hits = recommendationCatalog.filter(item => (matchesWorkTitle(work, item.title) || matchesWorkTitle(item, work.title)) && (!work.year || work.year === item.year)
    && (work.mediaType === 'unknown' || item.mediaType === 'unknown' || work.mediaType === item.mediaType));
  return new Set(hits.map(i => i.id)).size === 1 ? hits.find(i => i.title === work.title) || hits[0] : undefined;
}
export function localRecommendations(info: VideoInfo) {
  const raw = seedWork(info), known = catalogIdentity(raw);
  const seed: RecommendedWork = known ? { ...known, mediaType: raw.mediaType === 'unknown' ? known.mediaType : raw.mediaType,
    directors: [...new Set([...known.directors, ...raw.directors])], cast: known.cast.length ? known.cast : raw.cast,
    genres: [...new Set([...known.genres, ...raw.genres])] } : raw;
  return { seed, items: rankWorks(seed, recommendationCatalog) };
}

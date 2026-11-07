import data from './film-poster-data.json';
import type { FilmPosterMetadata } from './film-poster-metadata';
import { peopleCollections } from './people-collections';
import { contentGenres, matchesWorkTitle, personTokens, rankWorks, seedWork, type RecommendedWork } from './recommendations';
import type { VideoInfo } from './types';

const credits = new Map<string, { directors: string[]; cast: string[] }>();
const metadata = data as Record<string, FilmPosterMetadata>;
function metadataIdentity(key: string, meta: FilmPosterMetadata) {
  const subject = meta.doubanId || meta.source?.match(/movie\.douban\.com\/subject\/(\d+)/)?.[1];
  const tmdb = meta.source?.match(/themoviedb\.org\/(movie|tv)\/(\d+)/);
  const year = key.slice(key.lastIndexOf('|') + 1);
  return subject ? `douban:${subject}:${year}` : tmdb ? `tmdb:${tmdb[1]}:${tmdb[2]}:${year}` : key;
}
const aliases = new Map<string, string[]>();
for (const [key, meta] of Object.entries(metadata)) {
  const id = metadataIdentity(key, meta), names = aliases.get(id) || [];
  names.push(key.slice(0, key.lastIndexOf('|'))); aliases.set(id, names);
}
for (const person of peopleCollections) for (const section of person.sections) {
  const directing = person.role === 'director' || (person.role === 'both' && /^(导演|执导|自导)/.test(section.label));
  for (const [title, year] of section.films) {
    const key = `${title}|${year}`, value = credits.get(key) || { directors: [], cast: [] };
    (directing ? value.directors : value.cast).push(person.fullName || person.name);
    credits.set(key, value);
  }
}
export const recommendationCatalog: RecommendedWork[] = Object.entries(metadata).map(([key, raw]) => {
  const meta: FilmPosterMetadata = raw, at = key.lastIndexOf('|'), title = key.slice(0, at), year = key.slice(at + 1);
  const people = credits.get(key);
  const identity = metadataIdentity(key, meta);
  return { id: `local:${identity}`, title, year, aliases: (aliases.get(identity) || []).filter(name => name !== title), mediaType: meta.mediaType || (/themoviedb\.org\/tv\//.test(meta.source || '') ? 'tv' : /themoviedb\.org\/movie\//.test(meta.source || '') ? 'movie' : 'unknown'),
    metadata: { ...meta, director: meta.director || people?.directors.join(' / '), cast: meta.cast || people?.cast.join(' / ') },
    poster: meta.poster, genres: contentGenres(meta.genre), directors: [...new Set([...personTokens(meta.director), ...people?.directors || []])],
    cast: [...new Set([...personTokens(meta.cast), ...people?.cast || []])].slice(0, 5), score: 0, reasons: [], origin: 'catalog' };
});

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

import data from './film-poster-data.json';
import { resolveWork } from './work-catalog';

export interface FilmPosterMetadata {
  poster?: string;
  cast?: string;
  director?: string;
  intro?: string;
  genre?: string;
  area?: string;
  rating?: string;
  /** Missing values retain the existing Douban rating convention. */
  ratingSource?: string;
  doubanId?: string;
  source?: string;
  /** Optional explicit work type; an unknown format must not be guessed from a genre. */
  mediaType?: 'movie' | 'tv';
}

// Covers are stored locally after matching each title and release year.
const filmPosterMetadata = data as Readonly<Partial<Record<string, FilmPosterMetadata>>>;

export function getFilmPosterMetadata(title: string, year: number) {
  return filmPosterMetadata[`${title}|${year}`] || resolveWork(title, year)?.metadata;
}

const byDoubanId = new Map<string, { year: number; metadata: FilmPosterMetadata } | undefined>();
for (const [key, metadata] of Object.entries(filmPosterMetadata)) {
  const id = metadata?.doubanId ?? metadata?.source?.match(/^https:\/\/movie\.douban\.com\/subject\/(\d+)\/?$/)?.[1];
  if (id && metadata) {
    const year = Number(key.slice(key.lastIndexOf('|') + 1));
    byDoubanId.set(id, byDoubanId.has(id) ? undefined : { year, metadata });
  }
}

export function getFilmPosterMetadataByDoubanId(id: string) {
  return byDoubanId.get(id);
}

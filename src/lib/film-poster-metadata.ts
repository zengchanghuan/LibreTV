import data from './film-poster-data.json';

export interface FilmPosterMetadata {
  poster?: string;
  cast?: string;
  director?: string;
  intro?: string;
  genre?: string;
  rating?: string;
  /** Missing values retain the existing Douban rating convention. */
  ratingSource?: string;
  doubanId?: string;
  source?: string;
}

// Covers are stored locally after matching each title and release year.
const filmPosterMetadata: Readonly<Partial<Record<string, FilmPosterMetadata>>> = data;

export function getFilmPosterMetadata(title: string, year: number) {
  return filmPosterMetadata[`${title}|${year}`];
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

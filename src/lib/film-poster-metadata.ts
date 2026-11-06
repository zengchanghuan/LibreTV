import data from './film-poster-data.json';

export interface FilmPosterMetadata {
  poster?: string;
  cast?: string;
  genre?: string;
  rating?: string;
}

// Covers are stored locally after matching each title and release year.
export const filmPosterMetadata: Record<string, FilmPosterMetadata> = data;

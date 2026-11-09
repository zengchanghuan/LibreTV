import data from './korean-grand-slam-data.json';
import type { FilmCollection } from './film-collections';
import type { FilmPosterMetadata } from './film-poster-metadata';

export type GrandSlamAward = '青龙' | '大钟' | '百想';
export interface GrandSlamFilm {
  id: string;
  title: string;
  year: number;
  referenceTitle: string;
  posterLandscape?: boolean;
  coverKind?: 'still';
  coverSource?: string;
  aliases: string[];
  source: string;
  metadata: FilmPosterMetadata;
}
export interface GrandSlamActor {
  name: string;
  gender: 'male' | 'female';
  sources: string[];
  awards: { filmId: string; award: GrandSlamAward; year: number }[];
}
export const grandSlamFilms = data.films as GrandSlamFilm[];
export const grandSlamActors = data.actors as GrandSlamActor[];
export const grandSlamSingleActors = ['韩石圭', '崔岷植', '李秉宪', '罗文姬'];

/** Merge by verified film identity, never by translated title or award year. */
export function grandSlamActorFilms(actor: GrandSlamActor) {
  return [...new Set(actor.awards.map(record => record.filmId))].map(id => ({
    film: grandSlamFilms.find(film => film.id === id)!,
    awards: actor.awards.filter(record => record.filmId === id),
  }));
}
export const koreanGrandSlamCollection: FilmCollection = {
  id: 'korean-grand-slam', name: '韩国大满贯',
  intro: '青龙 · 大钟 · 百想电影最佳主角',
  sections: [{ label: '单片大满贯', mediaType: 'movie', films: grandSlamSingleActors.map(name => {
    const actor = grandSlamActors.find(actor => actor.name === name)!;
    const { film } = grandSlamActorFilms(actor)[0];
    return [film.title, film.year, name];
  }) }],
};

import { describe, expect, it } from 'vitest';
import { contextForFilm, buildSearchPlan, workResultStatus } from './work-search';
import { resolveWork } from './work-catalog';
import type { SearchResultItem } from './types';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { grandSlamActors, grandSlamFilms, grandSlamActorFilms, grandSlamSingleActors, koreanGrandSlamCollection } from './korean-grand-slam';

describe('韩国大满贯 curated collection', () => {
  it('resolves all 78 lead awards to distinct verified identities and preserves the supplied 26 actors', () => {
    expect(grandSlamActors).toHaveLength(26);
    expect(grandSlamActors.filter(a => a.gender === 'male')).toHaveLength(12);
    expect(new Set(grandSlamFilms.map(f => f.id)).size).toBe(grandSlamFilms.length);
    for (const actor of grandSlamActors) {
      expect(actor.awards.map(a => a.award)).toEqual(['青龙', '大钟', '百想']);
      expect(actor.sources.length).toBeGreaterThan(0);
      for (const award of actor.awards) expect(grandSlamFilms.find(f => f.id === award.filmId)).toBeDefined();
    }
  });
  it('merges repeated films without losing the ceremony years', () => {
    const oldboy = grandSlamActorFilms(grandSlamActors.find(a => a.name === '崔岷植')!);
    expect(oldboy).toHaveLength(1);
    expect(oldboy[0].film.year).toBe(2003);
    expect(oldboy[0].awards.map(a => a.year)).toEqual([2003, 2004, 2004]);
    expect(grandSlamActorFilms(grandSlamActors.find(a => a.name === '金允石')!)).toHaveLength(2);
  });
  it('keeps the four same-film sweeps separate from the Public Enemy grand prize exception', () => {
    expect(grandSlamSingleActors).toEqual(['韩石圭', '崔岷植', '李秉宪', '罗文姬']);
    for (const name of grandSlamSingleActors) expect(grandSlamActorFilms(grandSlamActors.find(a => a.name === name)!)).toHaveLength(1);
    expect(koreanGrandSlamCollection.sections[0].films.map(([title]) => title)).toEqual(['绿鱼', '老男孩', '局内人', '我能说']);
    expect(grandSlamActors.flatMap(a => a.awards).some(a => a.filmId === 'kofic-20020065')).toBe(false);
  });
  it('does not substitute same-title foreign films or ceremony years for film years', () => {
    expect(grandSlamFilms.find(f => f.title === '断箭')).toMatchObject({ id: 'kofic-20113535', year: 2012, referenceTitle: 'Unbowed' });
    expect(grandSlamFilms.find(f => f.title === '局内人')).toMatchObject({ id: 'kofic-20149314', year: 2015 });
    expect(grandSlamFilms.find(f => f.title === '国际市场')?.year).toBe(2014);
    expect(grandSlamFilms.find(f => f.title === '大院君')?.year).toBe(1968);
    expect(grandSlamFilms.find(f => f.title === '石花村')?.year).toBe(1972);
  });
  it('passes aliases and year/type identity through the shared search catalog', () => {
    const context = contextForFilm('我能说', 2017, 'movie');
    expect(context.workId).toBe('kofic-20174142');
    expect(buildSearchPlan('我能说', context).titles).toContain('花漾奶奶秀英文');
    expect(resolveWork('老男孩', 2003, 'movie')?.id).toBe('tmdb:movie:670');
    expect(resolveWork('1987', 2017, 'movie')?.id).toBe('tmdb:movie:437103');
    const plan = buildSearchPlan('断箭', contextForFilm('断箭', 2012, 'movie'));
    expect(workResultStatus({ name: '断箭', year: '1996', typeName: '动作片' } as SearchResultItem, plan)).toBe('reject');
  });
  it('ships readable credits and local posters without invented placeholders', () => {
    for (const film of grandSlamFilms) {
      expect(film.metadata.director).toBeTruthy();
      expect(film.metadata.cast).toBeTruthy();
      expect(film.metadata.intro).toBeTruthy();
      expect(film.source).toMatch(/^https:\/\//);
      if (film.metadata.poster) {
        expect(film.metadata.poster).toMatch(/^\/posters\//);
        expect(existsSync(join(process.cwd(), 'public', film.metadata.poster))).toBe(true);
      }
    }
  });
});

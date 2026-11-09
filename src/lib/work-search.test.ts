import { describe, expect, it } from 'vitest';
import { createWorkCatalog, getWork, resolveWork, workSearchTitles, type WorkTitleRecord } from './work-catalog';
import { buildSearchPlan, contextForFilm, contextFromParams, prepareWorkSearchResults, readSearchContext } from './work-search';
import { aggregateResults } from './search-result-groups';
import { searchPageUrl } from './hd-sources';
import { getFilmPosterMetadata } from './film-poster-metadata';
import { catalogIdentity, recommendationById, recommendationByTitle } from './recommendation-catalog';
import { seedWork } from './recommendations';
import type { SearchResultItem } from './types';

const original = '光海，成为王的男人';
const context = contextForFilm(original, 2012, 'movie');
const plan = buildSearchPlan(original, context);
const item = (name: string, vodId: string, extra: Partial<SearchResultItem> = {}): SearchResultItem => ({
  sourceKey: 'a', sourceName: 'A', name, vodId, year: '2012', typeName: '电影', ...extra,
});

describe('unified work titles', () => {
  it('shares metadata and identity across a literal title, common Chinese title and recommendation', () => {
    const film = resolveWork(original, 2012, 'movie')!;
    expect(film.id).toBe('tmdb:movie:133200');
    expect(film.title).toBe('双面君王');
    expect(resolveWork('双面君王', 2012, 'movie')).toBe(film);
    expect(getFilmPosterMetadata('双面君王', 2012)).toEqual(getFilmPosterMetadata(original, 2012));
    const known = catalogIdentity(seedWork({ title: original, year: '2012', typeName: '电影', sourceKey: '', sourceName: '' }));
    expect(known).toMatchObject({ title: '双面君王', aliases: expect.arrayContaining([original]) });
    expect(workSearchTitles(film, original)).toEqual(['双面君王', original]);
    expect(workSearchTitles(film, '双面君王')).toEqual(['双面君王', original]);
    expect(getWork(`title:${original}|2012`)).toBe(film);
    expect(recommendationByTitle(original, 2012)).toBe(recommendationByTitle('双面君王', 2012));
    expect(recommendationById(known!.id)).toBe(known);
  });

  it('does not pick a single work from a title collision or merge movie/TV numeric IDs', () => {
    const records: WorkTitleRecord[] = [
      { id: 'tmdb:movie:1', title: '同名作品', aliases: ['旧译名'], year: 2012, mediaType: 'movie', originalTitle: '', metadataKeys: ['旧译名|2012'] },
      { id: 'tmdb:tv:1', title: '同名作品', aliases: [], year: 2019, mediaType: 'tv', originalTitle: '', metadataKeys: ['同名作品|2019'] },
    ];
    const catalog = createWorkCatalog({}, records);
    expect(catalog.resolve('同名作品')).toBeUndefined();
    expect(catalog.resolve('同名作品', 2012, 'movie')?.id).toBe('tmdb:movie:1');
    expect(catalog.resolve('同名作品', 2019, 'tv')?.id).toBe('tmdb:tv:1');
    expect(catalog.resolve('同名作品', 2019, 'movie')).toBeUndefined();
  });

  it('does not propagate one verified identity through an incorrect shared poster citation', () => {
    const catalog = createWorkCatalog({
      '电影甲|1983': { source: 'https://movie.douban.com/subject/123/', mediaType: 'movie' },
      '电影乙|1983': { source: 'https://movie.douban.com/subject/123/', mediaType: 'movie' },
    }, [{ id: 'tmdb:movie:1', title: '电影甲', year: 1983, mediaType: 'movie', originalTitle: '', aliases: [], metadataKeys: ['电影甲|1983'] }]);
    expect(catalog.works).toHaveLength(2);
    expect(catalog.resolve('电影乙', 1983)?.title).toBe('电影乙');
    expect(catalog.byId.has('douban:123:1983')).toBe(false);
    expect(catalog.resolve('电影甲', 1983, 'movie', '123')).toBeUndefined();
  });

  it('round-trips the precise work through a shareable HD URL and rejects contradictory context', () => {
    const url = new URL(searchPageUrl('hd', original, context), 'https://example.com');
    expect(url.pathname).toBe('/hd');
    expect(contextFromParams(url.searchParams)).toMatchObject(context);
    expect(buildSearchPlan(url.searchParams.get('s')!, contextFromParams(url.searchParams)).strict).toBe(true);
    expect(readSearchContext({ ...context, year: '2019' })).toBeUndefined();
    expect(readSearchContext({ workId: 'invented' })).toBeUndefined();
    expect(readSearchContext({ year: 2012 })).toBeUndefined();
    expect(readSearchContext({ mediaType: 'evil' })).toBeUndefined();
    expect(buildSearchPlan('双面君王').strict).toBe(false);
  });
});

describe('alias search boundaries', () => {
  const results = [item(original, 'original'), item('双面君王', 'common'),
    item('双面君王', 'tv', { year: '2019', typeName: '韩国剧' }),
    item('双面君王', 'wrong-movie', { year: '2019' }),
    item('双面君王', 'same-year-tv', { typeName: '韩国剧' }),
    item('双面君王[电影解说]', 'commentary', { typeName: '电影解说' }),
    item('双面君王2', 'sequel'), item('别的君王', 'noise'),
    item('双面君王', 'unknown-year', { year: undefined }),
    item(original, 'unknown-type', { typeName: undefined })];

  it('accepts both names, rejects other years/types and isolates incomplete identity', () => {
    const list = prepareWorkSearchResults([...results, results[0]], plan);
    expect(list.map(i => i.vodId).sort()).toEqual(['common', 'original', 'unknown-type', 'unknown-year']);
    const groups = aggregateResults(list);
    expect(groups).toHaveLength(3);
    expect(groups[0]).toMatchObject({ name: '双面君王', year: '2012', mediaType: 'movie' });
    expect(groups[0].items.map(i => i.name).sort()).toEqual([original, '双面君王'].sort());
    expect(groups.slice(1).every(g => g.identityUnconfirmed && g.items.length === 1)).toBe(true);
    expect(prepareWorkSearchResults(list, plan)).toEqual(list);
  });

  it('manual search keeps same-name remakes and TV shows separate instead of silently filtering them', () => {
    const list = prepareWorkSearchResults(results, buildSearchPlan(original));
    expect(list.map(i => i.vodId)).toContain('tv');
    expect(list.map(i => i.vodId)).toContain('wrong-movie');
    const groups = aggregateResults(list);
    expect(groups.find(g => g.year === '2019' && g.mediaType === 'tv')?.items.map(i => i.vodId)).toEqual(['tv']);
  });

  it('continues to enforce adult filtering and exact requested seasons', () => {
    expect(prepareWorkSearchResults([item(original, 'adult', { isAdult: true })], plan)).toEqual([]);
    expect(prepareWorkSearchResults([item(original, 'adult', { isAdult: true })], plan, false)).toHaveLength(1);
    const list = prepareWorkSearchResults([item('鱿鱼游戏第一季', 'one'), item('鱿鱼游戏第二季', 'two')], buildSearchPlan('鱿鱼游戏2'));
    expect(list.map(i => i.vodId)).toEqual(['two']);
  });
});

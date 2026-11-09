import { describe, expect, it } from 'vitest';
import { searchResultIdentity, splitSearchTitle } from './search-result-identity';
import { aggregateResults } from './search-result-groups';
import { buildSearchPlan, prepareWorkSearchResults } from './work-search';
import type { SearchResultItem } from './types';

const item = (extra: Partial<SearchResultItem> = {}): SearchResultItem => ({
  sourceKey: 'a', sourceName: 'A', vodId: '1', name: '双面君王', year: '2012', typeName: 'movie', ...extra,
});
const plan = buildSearchPlan('双面君王');

describe('search identity evidence', () => {
  it.each(['', ' '])('reduces screenshot title variants (separator=%j) to two works and six pending entries without losing 19 sources', separator => {
    const rows: [string, string, string | undefined, number][] = [
      ['双面君王', '2012', 'movie', 2], ['双面君王', '2012', undefined, 1],
      ['双面君王', '2019', 'series', 6], ['双面君王', '2019', 'movie', 1],
      ['双面君王', '2013', 'movie', 2], [`双面君王${separator}2012`, '2011', '电影/剧情片', 1],
      [`双面君王${separator}2012`, '2019', '剧情片', 1], [`双面君王${separator}2012`, '2012', '剧情片', 4],
      ['双面君王 2019', '2019', '电视剧/韩国剧', 1],
    ];
    let n = 0;
    const input = rows.flatMap(([name, year, typeName, count]) => Array.from({ length: count }, () =>
      item({ name, year, typeName, sourceKey: `s${++n}`, vodId: String(n) })));
    const list = prepareWorkSearchResults(input, plan);
    const groups = aggregateResults(list);
    expect(list).toHaveLength(19);
    expect(groups.filter(g => !g.identityUnconfirmed).map(g => [g.name, g.year, g.mediaType, g.items.length]))
      .toEqual([['双面君王', '2012', 'movie', 6], ['双面君王', '2019', 'tv', 7]]);
    expect(groups.filter(g => g.identityUnconfirmed)).toHaveLength(6);
    expect(groups.flatMap(g => g.items)).toHaveLength(19);
    expect(prepareWorkSearchResults(list, plan)).toEqual(list);
    expect(aggregateResults([...list].reverse()).filter(g => !g.identityUnconfirmed).map(g => g.items.length).sort()).toEqual([6, 7]);
  });

  it.each(['1917', '1984', '大明1566', '2001太空漫游', '钢铁侠2', '鱿鱼游戏第二季', '银翼杀手2049', '双面君王2049', '未收录作品2012'])('preserves numeric titles and sequels: %s', title => {
    expect(splitSearchTitle(title)).toEqual({ title, year: undefined });
  });

  it.each(['双面君王2012', '双面君王２０１２', '光海，成为王的男人2012', '双面君王 2012', '双面君王（2012）', '双面君王 [2012]'])('recognizes a supported year suffix in %s without rewriting source data', name => {
    const source = item({ name });
    const list = prepareWorkSearchResults([source], plan);
    expect(list[0].name).toBe(name);
    expect(list[0].workId).toBe('tmdb:movie:133200');
    expect(aggregateResults(list)[0].name).toBe('双面君王');
  });

  it('merges the first and fourth mobile cards but keeps the actual contradictory 360 record pending', () => {
    const input = [item(), item({ vodId: '2', year: '2019', typeName: 'series' }),
      item({ vodId: '3', name: '双面君王2012', year: '2019', typeName: '剧情片' }),
      item({ vodId: '4', name: '双面君王2012', year: '2012', typeName: '剧情片' })];
    const initial = aggregateResults(prepareWorkSearchResults(input, plan));
    expect(initial.filter(g => !g.identityUnconfirmed).map(g => [g.mediaType, g.items.map(i => i.vodId)]))
      .toEqual([['movie', ['1', '4']], ['tv', ['2']]]);
    expect(initial.find(g => g.identityUnconfirmed)).toMatchObject({ identityReason: '标题年份与片源资料不一致', items: [{ vodId: '3' }] });
    // 360 API record 5342: its actual staff fields do not corroborate the 2012 movie.
    input[2].identityDetails = { title: '双面君王2012', year: '2019', typeName: '剧情片', director: '金希元', actor: '吕珍九,李世荣,金相庆,权海骁,张光,' };
    const enriched = prepareWorkSearchResults(input, plan);
    const groups = aggregateResults(enriched);
    expect(groups.filter(g => !g.identityUnconfirmed)).toHaveLength(2);
    expect(groups.find(g => g.mediaType === 'movie' && !g.identityUnconfirmed)?.items.map(i => i.vodId).sort()).toEqual(['1', '4']);
    expect(enriched.find(i => i.vodId === '3')).toMatchObject({ name: '双面君王2012', year: '2019', identityUnconfirmed: true });
    expect(prepareWorkSearchResults(enriched, plan)).toEqual(enriched);
  });

  it('uses detail classification to join a confirmed work while preserving the incomplete original listing', () => {
    const source = item({ vodId: '2', typeName: undefined, identityDetails: { title: '光海，成为王的男人', year: '2012', typeName: '电影' } });
    const list = prepareWorkSearchResults([item(), source], plan);
    expect(aggregateResults(list)).toHaveLength(1);
    expect(list.find(i => i.vodId === '2')?.typeName).toBeUndefined();
  });

  it('requires a director and two cast matches before correcting inconsistent metadata', () => {
    const source = item({ name: '双面君王2012', year: '2019', typeName: 'series',
      identityDetails: { director: '秋昌民', actor: '李秉宪,柳承龙,韩孝周' } });
    expect(searchResultIdentity(source)).toMatchObject({ year: '2012', mediaType: 'movie', work: { id: 'tmdb:movie:133200' } });
    expect(searchResultIdentity({ ...source, identityDetails: { actor: '李秉宪,柳承龙,韩孝周' } }).reason).toBeTruthy();
    expect(searchResultIdentity({ ...source, identityDetails: { director: '秋昌民', actor: '李秉宪' } }).reason).toBeTruthy();
    expect(source.year).toBe('2019');
  });

  it('does not use wrong-title details or derivative metadata to identify the feature film', () => {
    expect(searchResultIdentity(item({ identityDetails: { title: '无关电影', year: '2012', typeName: '电影' } })).reason)
      .toBe('详情名称与搜索结果不一致');
    expect(searchResultIdentity(item({ name: '双面君王[电影解说]', typeName: '电影解说' })).work).toBeUndefined();
  });

  it('keeps fully specified same-name remakes and different seasons separate', () => {
    const list = prepareWorkSearchResults([
      item({ name: '未收录作品', year: '1994' }), item({ name: '未收录作品', year: '2024', vodId: '2' }),
    ], buildSearchPlan('未收录作品'));
    expect(aggregateResults(list).map(g => [g.year, !!g.identityUnconfirmed])).toEqual([['1994', false], ['2024', false]]);
    const seasons = prepareWorkSearchResults([
      item({ name: '未收录剧集第一季', typeName: 'series' }), item({ name: '未收录剧集第二季', typeName: 'series', vodId: '2' }),
    ], buildSearchPlan('未收录剧集'));
    expect(aggregateResults(seasons)).toHaveLength(2);
  });

  it('filters adult detail classifications and does not merge same-ID entries from different sources', () => {
    expect(prepareWorkSearchResults([item({ identityDetails: { typeName: '伦理片' } })], plan)).toEqual([]);
    expect(prepareWorkSearchResults([item(), item({ sourceKey: 'b' }), item()], plan)).toHaveLength(2);
  });
});

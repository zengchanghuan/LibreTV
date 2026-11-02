import { describe, expect, it } from 'vitest';
import { classifyMediaType } from './media-type';
import { aggregateResults } from './search-result-groups';
import type { SearchResultItem } from './types';

const item = (overrides: Partial<SearchResultItem> = {}): SearchResultItem => ({
  sourceKey: 'a', sourceName: '来源 A', vodId: '1', name: '同名作品', year: '2024', ...overrides,
});

describe('搜索结果内容分类', () => {
  it.each(['剧情片', '动作片', '喜剧片', '爱情片', '恐怖片', '动画片', '动漫电影', '剧场版', 'movie', 'film'])('%s 标为电影', (type) => {
    expect(classifyMediaType(type)).toBe('movie');
  });
  it.each(['国产剧', '连续剧', '香港剧', '韩国剧', '日本剧', '欧美剧', '韩剧', '台灣劇', '电视剧', 'tv', 'TV Series'])('%s 标为电视剧', (type) => {
    expect(classifyMediaType(type)).toBe('tv');
  });
  it.each([
    ['国产动漫', 'animation'], ['日韩综艺', 'variety'], ['纪录片', 'documentary'],
    ['短剧', 'short'], ['电影解说', 'commentary'], ['', 'unknown'],
    ['剧情', 'unknown'], ['HD', 'unknown'], ['已完结', 'unknown'],
  ])('%s 保留其准确分类', (type, expected) => {
    expect(classifyMediaType(type)).toBe(expected);
  });
});

describe('搜索结果分组', () => {
  it('同名同年的电影与电视剧分开，保留各自来源', () => {
    const movie = item({ typeName: '剧情片' });
    const tv = item({ vodId: '2', typeName: '国产剧' });
    const otherMovie = item({ sourceKey: 'b', typeName: '电影' });
    const groups = aggregateResults([movie, tv, otherMovie]);
    expect(groups.map((g) => [g.mediaType, g.items])).toEqual([
      ['movie', [movie, otherMovie]], ['tv', [tv]],
    ]);
    expect(new Set(groups.map((g) => g.key)).size).toBe(2);
  });

  it('单一已知类型可补齐另一个来源的缺失分类', () => {
    const groups = aggregateResults([item(), item({ sourceKey: 'b', typeName: '欧美剧' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].mediaType).toBe('tv');
    expect(groups[0].typeName).toBe('欧美剧');
    expect(groups[0].items).toHaveLength(2);
  });

  it('多种已知类型存在时，缺失分类的结果不随意并入电影或剧集', () => {
    const groups = aggregateResults([item(), item({ typeName: '剧情片' }), item({ typeName: '国产剧' })]);
    expect(groups.map((g) => g.mediaType)).toEqual(['unknown', 'movie', 'tv']);
    expect(groups.every((g) => g.items.length === 1)).toBe(true);
  });

  it('同类型的不同年份翻拍仍分开，缺失年份保持独立', () => {
    const groups = aggregateResults([
      item({ typeName: '剧情片' }), item({ typeName: '爱情片', year: '1994' }),
      item({ typeName: '电影', year: undefined }), item({ name: ' ', typeName: '电影' }),
    ]);
    expect(groups.map((g) => g.year)).toEqual(['2024', '1994', undefined]);
    expect(groups.every((g) => g.mediaType === 'movie')).toBe(true);
  });

  it('不同名称保持原序，分类全部缺失时也能聚合', () => {
    const groups = aggregateResults([item(), item({ sourceKey: 'b' }), item({ name: '另一作品' })]);
    expect(groups.map((g) => g.name)).toEqual(['同名作品', '另一作品']);
    expect(groups[0].mediaType).toBe('unknown');
    expect(groups[0].items).toHaveLength(2);
  });

  it('不同年份的同名作品不互相借用分类', () => {
    const groups = aggregateResults([item({ typeName: '电影' }), item({ year: '1994' }), item({ year: undefined })]);
    expect(groups.map((g) => [g.year, g.mediaType])).toEqual([
      ['2024', 'movie'], ['1994', 'unknown'], [undefined, 'unknown'],
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import { localRecommendations } from './recommendation-catalog';
import { contentGenres, rankWorks, resourceMatch, seedWork, type RecommendedWork } from './recommendations';

const seed = seedWork({ title: '亲切的金子', year: '2005', typeName: '电影', director: 'Park Chan-wook', sourceKey: 's', sourceName: '测试' });
const work = (title: string, extra: Partial<RecommendedWork> = {}): RecommendedWork => ({ ...seed, id: title, title, origin: 'catalog', directors: [], genres: [], ...extra });
const hit = (extra = {}) => ({ sourceKey: 's', sourceName: '测试', vodId: '1', name: '老男孩', year: '2003', typeName: '电影', ...extra });

describe('content-first recommendations', () => {
  it('recalls Oldboy and Sympathy from the catalog without asking the playing source', () => {
    const result = localRecommendations({ title: seed.title, year: seed.year, typeName: '剧情 / 惊悚', director: 'Lee Kyoung-mi / Park Chan-wook', sourceKey: 'env_11', sourceName: '4K影视' });
    expect(result.items.slice(0, 2).map(i => i.title)).toEqual(['老男孩', '我要复仇']);
    expect(result.items.every(i => !['亲切的金子', '交通费', '生化危机：爆发夜'].includes(i.title))).toBe(true);
    expect(result.items[0].reasons).toContain('同导演 · 朴赞郁');
    expect(result.items[0]).not.toHaveProperty('sourceKey');
  });
  it('does not invent associations from region categories or a single generic genre', () => {
    expect(contentGenres('韩剧 / 国产剧 / 剧情 / 惊悚片')).toEqual(['剧情', '惊悚']);
    const current = { ...seed, genres: ['剧情', '惊悚', '犯罪'] };
    const ranked = rankWorks(current, [work('家庭喜剧', { genres: ['剧情', '喜剧'] }), work('犯罪惊悚', { genres: ['犯罪', '惊悚'] })]);
    expect(ranked.map(i => i.title)).toEqual(['犯罪惊悚']);
  });
  it('keeps movie/TV conflicts and adult content out of content candidates', () => {
    expect(rankWorks(seed, [work('剧集', { directors: seed.directors, mediaType: 'tv' }), work('成人', { directors: seed.directors, genres: ['情色'] })])).toEqual([]);
  });
  it('does not use an ambiguous current title to borrow another remake’s credits', () => {
    const result = localRecommendations({ title: '老男孩', year: '1999', typeName: '电影', sourceKey: '', sourceName: '' });
    expect(result.seed.directors).toEqual([]);
    expect(result.items).toEqual([]);
  });
});

describe('resource identity checks', () => {
  const target = work('老男孩', { year: '2003' });
  it('rejects remakes, TV, commentary and substring hits', () => {
    expect(resourceMatch(target, hit())).toBe('match');
    for (const extra of [{ year: '2013' }, { typeName: '电视剧' }, { name: '老男孩[电影解说]' }, { name: '老男孩之猛龙过江' }]) {
      expect(resourceMatch(target, hit(extra))).toBe('reject');
    }
    expect(resourceMatch(target, hit({ year: undefined }))).toBe('detail');
  });
  it('recognizes edition labels and equivalent season numerals without mixing seasons', () => {
    expect(resourceMatch(target, hit({ name: '老男孩（国语版）' }))).toBe('match');
    const series = work('鱿鱼游戏第二季', { year: '2024', mediaType: 'tv' });
    expect(resourceMatch(series, hit({ name: '鱿鱼游戏2', year: '2024', typeName: '韩剧' }))).toBe('match');
    expect(resourceMatch(series, hit({ name: '鱿鱼游戏第三季', year: '2024', typeName: '韩剧' }))).toBe('reject');
    expect(resourceMatch(series, hit({ name: '鱿鱼游戏', year: '2024', typeName: '韩剧' }))).toBe('reject');
  });
});

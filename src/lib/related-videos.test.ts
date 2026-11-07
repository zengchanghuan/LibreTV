import { describe, expect, it } from 'vitest';
import { parseRelatedCandidates, rankRelatedVideos, relatedTitle, seriesQuery, type RelatedCandidate } from './related-videos';

const source = { key: 'test', name: '测试源', url: 'https://media.example/api' };
const movie = (vodId: string, name: string, extra: Partial<RelatedCandidate> = {}): RelatedCandidate => ({
  sourceKey: source.key, sourceName: source.name, sourceUrl: source.url,
  vodId, name, typeName: '科幻片', genres: '冒险', year: '2020', area: '中国大陆', ...extra,
});
const seed = movie('1', '流浪地球', { director: '郭帆', actor: '吴京,屈楚萧' });

describe('related video ranking', () => {
  it('ranks series, directors, shared actors and genre in that order with explanations', () => {
    const result = rankRelatedVideos(seed, [
      movie('2', '普通科幻'), movie('3', '演员作品', { actor: '吴京 / 刘德华' }),
      movie('4', '导演作品', { director: '郭帆' }), movie('5', '流浪地球2'),
    ]);
    expect(result.map((item) => item.vodId)).toEqual(['5', '4', '3', '2']);
    expect(result[0].reasons).toContain('相近系列片名');
    expect(result[1].reasons).toContain('同导演 · 郭帆');
    expect(result[2].reasons).toContain('共同主演 · 吴京');
  });
  it('removes the current film, language versions and repeated pages, keeping distinct remakes', () => {
    const result = rankRelatedVideos(seed, [seed, movie('2', '流浪地球（国语版）'),
      movie('3', '另一个世界'), movie('4', '另一个世界粤语'), movie('3', '另一个世界'),
      movie('5', '另一个世界', { year: '1990' })]);
    expect(result).toHaveLength(2);
    expect(result.map((item) => item.year).sort()).toEqual(['1990', '2020']);
  });
  it('does not recommend by year/region alone or unknown metadata', () => {
    expect(rankRelatedVideos(movie('1', '电影甲', { typeName: '电影', director: '未知', actor: 'N/A' }), [
      movie('2', '电影乙', { typeName: '电影', director: '未知', actor: 'N/A' }),
      movie('3', '爱情故事', { typeName: '爱情片' }),
    ])).toEqual([]);
  });
  it('uses exact person names, preserving spaces within English names', () => {
    const current = movie('1', 'Inception', { director: 'Christopher Nolan', actor: '张三丰' });
    const result = rankRelatedVideos(current, [
      movie('2', 'Interstellar', { director: 'Christopher Nolan / Other Director' }),
      movie('3', '演员作品', { actor: '张三' }),
    ]);
    expect(result[0].reasons).toContain('同导演 · Christopher Nolan');
    expect(result[1].reasons.some((reason) => reason.includes('主演'))).toBe(false);
  });
  it('excludes television, trailers and commentary from movie results', () => {
    expect(rankRelatedVideos(seed, [
      movie('2', '流浪地球2预告片'), movie('3', '流浪地球解说'),
      movie('4', '流浪地球：新篇', { typeName: '国产剧', director: '郭帆' }),
    ])).toEqual([]);
  });
  it('respects adult filtering on both category and source metadata', () => {
    const candidates = [movie('2', '导演作品', { typeName: '伦理片', director: '郭帆' }),
      movie('3', '同类影片', { isAdult: true })];
    expect(rankRelatedVideos(seed, candidates)).toEqual([]);
    expect(rankRelatedVideos(seed, candidates, false)).toHaveLength(2);
  });
  it('caps output at 12, rejects invalid identities and produces deterministic ordering', () => {
    const candidates = Array.from({ length: 20 }, (_, index) => movie(String(index + 2), `电影${index}`));
    const first = rankRelatedVideos(seed, [...candidates, movie('', '无ID'), movie('../oops', '坏ID')]);
    expect(first).toHaveLength(12);
    expect(rankRelatedVideos(seed, [...candidates].reverse())).toEqual(first);
  });
  it('recognizes numeric seasons and colon subtitles without truncating ordinary title words', () => {
    expect(seriesQuery('流浪地球2')).toBe('流浪地球');
    expect(seriesQuery('流浪地球：新篇')).toBe('流浪地球');
    expect(seriesQuery('庆余年第二季')).toBe('庆余年');
    expect(seriesQuery('1917')).toBeUndefined();
    expect(relatedTitle('英语老师')).toBe('英语老师');
    expect(relatedTitle('电影（国语版）')).toBe('电影');
    expect(relatedTitle('流浪地球2')).toBe('流浪地球2');
  });
  it('reads numeric years and metadata without per-candidate detail calls', () => {
    const [item] = parseRelatedCandidates({ list: [{ vod_id: 12, vod_name: '示例', type_id: 6,
      vod_year: 2024, vod_class: '动作,科幻', vod_director: '导演', vod_actor: '演员' }] }, source);
    expect(item).toMatchObject({ vodId: '12', typeId: '6', year: '2024', director: '导演', actor: '演员', genres: '动作,科幻' });
    expect(parseRelatedCandidates({ list: null }, source)).toEqual([]);
  });
});

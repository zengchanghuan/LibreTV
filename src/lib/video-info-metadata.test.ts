import { describe, expect, it } from 'vitest';
import { enrichVideoInfo, matchVideoWork } from './video-info-metadata';
import { parseDetail } from './cms-parser';
import type { VideoInfo } from './types';

const taxi: VideoInfo = { title: '出租车司机', year: '2017', director: '张勋', actor: '宋康昊 / 柳海真 / 柳俊烈', sourceKey: 'test', sourceName: '测试资源' };
describe('watch-page film metadata', () => {
  it('adds the stored IMDb rating and original title when screenshot evidence matches', () => {
    const result = enrichVideoInfo(taxi);
    expect(result.rating).toEqual({ value: '7.9', source: 'IMDb', url: 'https://www.imdb.com/title/tt6878038/' });
    expect(result.originalTitle).toBe('택시운전사');
    expect(result.aliases).toContain('逆權司機');
    expect(result.aliases).not.toContain('出租车司机(2017)');
    expect(result.director).toBe(taxi.director);
    expect(result.actor).toBe(taxi.actor);
  });
  it.each(['逆權司機', '我只是個計程車司機', '택시운전사', 'A Taxi Driver'])('resolves verified alternate name %s', title => {
    expect(enrichVideoInfo({ ...taxi, title }).rating).toEqual(enrichVideoInfo(taxi).rating);
  });
  it('distinguishes the 1976 movie and keeps its rating provenance', () => {
    const classic = enrichVideoInfo({ title: '出租车司机', year: '1976', typeName: '剧情片', sourceKey: 'test', sourceName: '测试资源' });
    expect(classic.rating?.source).toBe('豆瓣');
    expect(classic.rating?.url).toMatch(/^https:\/\/movie.douban.com\/subject\/\d+\/$/);
    expect(classic.originalTitle).not.toBe('택시운전사');
  });
  it.each([
    { year: undefined }, { year: '2018' }, { year: '1976' }, { director: '马丁·斯科塞斯' },
    { actor: '罗伯特·德尼罗' }, { title: '出租车司机[电影解说]' }, { typeName: '韩国剧' },
    { title: '出租车司机(1976)' },
  ])('does not attach another film rating for conflicting or missing evidence: %j', changes => {
    expect(enrichVideoInfo({ ...taxi, ...changes }).rating).toBeUndefined();
  });
  it('requires staff corroboration when type is missing, even for a unique name/year', () => {
    expect(matchVideoWork({ ...taxi, director: undefined, actor: undefined })).toBeUndefined();
  });
  it('preserves source fields, episode URLs and type while adding catalog genre', () => {
    const source = { key: 'test', name: '测试资源', url: 'https://example.com/api' };
    const parsed = parseDetail({ list: [{ vod_name: '出租车司机', vod_year: 2017, type_name: '剧情片', vod_director: '张勋', vod_content: '片源简介', vod_lang: '韩语', vod_duration: '137', vod_pubdate: '2017-08-02(韩国)', vod_play_url: '正片$https://example.com/movie.m3u8', vod_score: '10.0', vod_douban_score: '9.9' }] }, source);
    const enriched = enrichVideoInfo(parsed.videoInfo);
    expect(enriched).toMatchObject({ typeName: '剧情片', genre: '剧情', desc: '片源简介', language: '韩语', duration: '137 分钟', releaseDate: '2017-08-02(韩国)', rating: { value: '7.9', source: 'IMDb' } });
    expect(parsed.episodes).toEqual(['https://example.com/movie.m3u8']);
  });
  it('does not invent runtime/date from placeholders or an update timestamp', () => {
    const parsed = parseDetail({ list: [{ vod_name: '未收录影片', vod_duration: '0', vod_pubdate: '未知', vod_time: '2026-11-11', vod_score: '8.0' }] }, { key: 'test', name: 'test', url: 'https://example.com' });
    expect(enrichVideoInfo(parsed.videoInfo).rating).toBeUndefined();
    expect(enrichVideoInfo(parsed.videoInfo)).toMatchObject({ duration: undefined, releaseDate: undefined });
  });
});

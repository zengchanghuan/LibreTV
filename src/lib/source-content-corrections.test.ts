import { describe, expect, it } from 'vitest';
import { canRecommendSource, correctSearchItem, correctVideoDetail, sourceContentIssue } from './source-content-corrections';
import { buildSearchPlan, prepareWorkSearchResults } from './work-search';
import { aggregateResults } from './search-result-groups';
import { searchResultIdentity } from './search-result-identity';
import { enrichVideoInfo } from './video-info-metadata';
import type { SearchResultItem, VideoDetail } from './types';

const url = 'https://360zy.com/api.php/provide/vod';
const item: SearchResultItem = { sourceKey: 'env_3', sourceUrl: url, sourceName: '360资源', vodId: '8737',
  name: '局内人', year: '2015', typeName: '剧情片', pic: 'https://img.example/korean.jpg',
  workId: 'tmdb:movie:293413', identityDetails: { title: '局内人', year: '2015', typeName: '剧情片', director: '禹民镐', actor: '李秉宪,曹承佑,白润植' } };
const detail: VideoDetail = { episodes: ['https://vod2.maowushi.com/jqp/PgtkJlCJ/index.m3u8'], videoInfo: {
  sourceKey: 'env_3', sourceName: '360资源', sourceUrl: url, title: '局内人', year: '2015', area: '韩国',
  director: '禹民镐', actor: '李秉宪,曹承佑,白润植', cover: item.pic, desc: '韩国电影简介',
  rating: { value: '8.1', source: '豆瓣' }, originalTitle: '내부자들', aliases: ['寒流黑金'], genre: '犯罪',
} };

describe('known source/video content mismatches', () => {
  it.each([url, url+'/', url+'?ac=videolist&ids=8737', 'http://www.360zy.com/api.php/provide/vod/'])('matches normalized source URL %s independently of env keys', sourceUrl => {
    expect(sourceContentIssue(sourceUrl, '8737')?.status).toBe('content-mismatch');
    expect(canRecommendSource({ ...item, sourceKey: 'custom_99', sourceUrl })).toBe(false);
  });
  it('does not quarantine other sources or the other 360 entry', () => {
    for (const sourceUrl of ['https://other.example/api.php/provide/vod', 'https://360zy.com.evil.example/api.php/provide/vod', 'https://360zy.com/other', undefined]) {
      expect(sourceContentIssue(sourceUrl, '8737')).toBeUndefined();
    }
    expect(canRecommendSource({ ...item, vodId: '72384' })).toBe(true);
    expect(canRecommendSource({ ...item, sourceUrl: undefined }, url)).toBe(false);
  });
  it.each([{}, { year: '2015', mediaType: 'movie' as const }])('keeps the bad item accessible but separate in ordinary and strict searches: %j', context => {
    const results = prepareWorkSearchResults([item, { ...item, vodId: '72384' }], buildSearchPlan('局内人', context));
    const bad = results.find(value => value.vodId === '8737')!;
    expect(bad).toMatchObject({ identityUnconfirmed: true });
    expect(bad.workId).toBeUndefined();
    expect(bad.pic).toBeUndefined();
    expect(searchResultIdentity(bad)).toMatchObject({ mediaType: 'unknown' });
    expect(searchResultIdentity(bad).year).toBeUndefined();
    const groups = aggregateResults(results);
    expect(groups).toHaveLength(2);
    expect(groups.find(group => !group.identityUnconfirmed)?.items.map(value => value.vodId)).toEqual(['72384']);
    expect(groups.find(group => group.identityUnconfirmed)).toMatchObject({ name: '局内人', year: undefined, pic: undefined });
  });
  it('rechecks stale client search results even when they claim a confirmed work', () => {
    const groups = aggregateResults([item, { ...item, vodId: '72384' }]);
    expect(groups).toHaveLength(2);
    expect(groups.find(group => group.items[0].vodId === '8737')?.identityUnconfirmed).toBe(true);
    expect(correctSearchItem(item).identityReason).toContain('源站资料与实际视频不符');
  });
  it('removes false movie metadata without changing the manual playback URL, including cached enrichment', () => {
    const corrected = correctVideoDetail(detail, url, '8737');
    expect(corrected.episodes).toEqual(detail.episodes);
    expect(corrected.videoInfo).toEqual({ title: '局内人', sourceKey: 'env_3', sourceName: '360资源', sourceUrl: url,
      contentIssue: sourceContentIssue(url, '8737', detail.episodes) });
    expect(enrichVideoInfo(corrected.videoInfo)).toEqual(corrected.videoInfo);
    expect(correctVideoDetail(corrected, url, '8737')).toEqual(corrected);
    expect(correctVideoDetail(detail, url, '72384')).toBe(detail);
  });
  it('requires a fresh review after upstream replaces or adds playback URLs', () => {
    for (const episodes of [[], ['https://cdn.example/new.m3u8'], [...detail.episodes, 'https://cdn.example/new.m3u8']]) {
      const corrected = correctVideoDetail({ ...detail, episodes }, url, '8737');
      expect(corrected.videoInfo.contentIssue?.status).toBe('needs-recheck');
      expect(corrected.videoInfo.cover).toBeUndefined();
      expect(canRecommendSource(item)).toBe(false);
    }
  });
});

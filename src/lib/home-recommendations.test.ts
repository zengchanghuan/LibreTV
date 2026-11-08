import { describe, expect, it } from 'vitest';
import { homeDay } from './home-discovery-types';
import { buildHomeRecommendations, eligibleHomeWork, verifiedHomeAI } from './home-recommendations';
import { recommendationCatalog } from './recommendation-catalog';
import { seriesQuery } from './related-videos';

const now = Date.parse('2026-11-08T04:00:00Z');
describe('daily discovery selection', () => {
  it('uses Shanghai midnight and stable daily ordering across refreshes', () => {
    expect(homeDay(Date.parse('2026-11-08T15:59:59Z'))).toBe('2026-11-08');
    expect(homeDay(Date.parse('2026-11-08T16:00:00Z'))).toBe('2026-11-09');
    const first = buildHomeRecommendations(true, [], now);
    expect(first.expiresAt).toBe('2026-11-08T16:00:00.000Z');
    expect(first.batches).toEqual(buildHomeRecommendations(true, [], now + 1000).batches);
    expect(first.batches).not.toEqual(buildHomeRecommendations(true, [], now + 86400000).batches);
  });
  it('offers three non-overlapping batches and limits repeated cast/series', () => {
    const { batches } = buildHomeRecommendations(true, [], now);
    expect(batches.map(b => b.length)).toEqual([12, 12, 12]);
    expect(new Set(batches.flat().map(w => w.id)).size).toBe(36);
    for (const batch of batches) {
      const actors = new Map<string, number>(), series = new Map<string, number>();
      for (const w of batch) {
        w.cast.forEach(p => actors.set(p, (actors.get(p) || 0) + 1));
        const key = seriesQuery(w.title); if (key) series.set(key, (series.get(key) || 0) + 1);
        expect(w.poster).toBeTruthy(); expect(w.metadata?.source).toBeTruthy();
      }
      expect(Math.max(0, ...actors.values())).toBeLessThanOrEqual(3);
      expect(Math.max(0, ...series.values())).toBeLessThanOrEqual(2);
    }
  });
  it('accepts only verified AI identities and discards invented metadata or aliases', () => {
    const known = recommendationCatalog.find(w => w.title === '精武英雄')!;
    const ai = { ...known, origin: 'ai' as const, aiReason: '武术与人物成长', metadata: { rating: '99' }, poster: '/invented.jpg' };
    const verified = verifiedHomeAI([ai, { ...ai, title: '虚构作品', aliases: ['精武英雄'] }, { ...ai, year: '1800' }], true);
    expect(verified).toHaveLength(1);
    expect(verified[0].poster).toBe(known.poster);
    expect(verified[0].metadata).toEqual(known.metadata);
    expect(buildHomeRecommendations(true, [ai], now).batches[0][0].origin).toBe('ai');
  });
  it('filters adult metadata and keeps weekly topics stable through Sunday', () => {
    const known = recommendationCatalog.find(w => w.title === '精武英雄')!;
    const adult = { ...known, metadata: { ...known.metadata, genre: '剧情 / 情色' } };
    expect(eligibleHomeWork(adult, true)).toBe(false);
    expect(eligibleHomeWork(adult, false)).toBe(true);
    const a = buildHomeRecommendations(true, [], now);
    expect(a.batches.flat().some(w => w.genres.includes('情色'))).toBe(false);
    expect(a.collections).toHaveLength(3);
    expect(a.collections).toEqual(buildHomeRecommendations(true, [], now - 86400000).collections);
  });
});

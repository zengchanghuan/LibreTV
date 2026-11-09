import { describe, expect, it } from 'vitest';
import { homePreferenceScore, samePreferenceWork } from './home-preferences';
import { buildHomeRecommendations } from './home-recommendations';
import { recommendationCatalog } from './recommendation-catalog';
import type { HomePreference, HomeVote } from './home-feedback-types';
import type { RecommendedWork } from './recommendations';

const known = recommendationCatalog.find(work => work.title === '精武英雄')!;
const preference = (vote: HomeVote, work = known): HomePreference => ({ workId: work.id, work, vote, updatedAt: 1 });
const candidate: RecommendedWork = { ...known, id: 'another', title: '另一部作品', genres: ['动作', '武侠'], directors: ['张三'], cast: ['李四'] };

describe('personal recommendation signals', () => {
  it('boosts shared director, cast and specific genres and downranks the same signals after a dislike', () => {
    const seed = { ...candidate, id: 'seed', title: '种子影片' };
    const like = homePreferenceScore(candidate, [preference('like', seed)]);
    expect(like.score).toBe(95); expect(like.reason).toContain('张三');
    expect(homePreferenceScore(candidate, [preference('dislike', seed)]).score).toBe(-95);
    expect(homePreferenceScore(candidate, [preference('like', { ...seed, directors: [], cast: [], genres: ['喜剧'] })]).score).toBe(0);
    expect(homePreferenceScore({ ...candidate, genres: ['剧情'], directors: [], cast: [] }, [preference('like', { ...seed, genres: ['剧情'] })]).score).toBeLessThanOrEqual(2);
    expect(homePreferenceScore(candidate, [preference('like', { ...seed, directors: [] })]).reason).toContain('李四');
    expect(homePreferenceScore(candidate, [preference('like', { ...seed, directors: [], cast: [] })]).reason).toContain('动作');
  });
  it('matches canonical identity and aliases across sources but keeps remakes separate', () => {
    const vote = preference('dislike', { ...known, id: 'discovery:source', title: known.title + '国语' });
    expect(samePreferenceWork(known, vote)).toBe(true);
    expect(samePreferenceWork({ ...known, year: '2000' }, vote)).toBe(false);
    expect(samePreferenceWork({ ...known, mediaType: 'tv' }, preference('dislike', { ...known, id: 'other', mediaType: 'movie' }))).toBe(false);
  });
  it('changes recommendations across the full catalog, excludes dislikes even from AI, and preserves diversity', () => {
    const now = Date.parse('2026-11-09T00:00:00Z');
    const preferences = [preference('like')];
    const baseline = buildHomeRecommendations(true, [], now);
    const personal = buildHomeRecommendations(true, [], now, preferences);
    expect(personal.batches).not.toEqual(baseline.batches);
    expect(personal.batches[0].some(work => work.reasons[0].startsWith('你喜欢的'))).toBe(true);
    expect(personal.batches[0].some(work => homePreferenceScore(work, preferences).score === 0)).toBe(true);
    const total = (works: RecommendedWork[]) => works.reduce((sum, work) => sum + homePreferenceScore(work, preferences).score, 0);
    expect(total(personal.batches[0])).toBeGreaterThan(total(baseline.batches[0]));
    const disliked = buildHomeRecommendations(true, [{ ...known, origin: 'ai', aiReason: '推荐理由' }], now, [preference('dislike')]);
    expect(disliked.batches.flat().map(work => work.id)).not.toContain(known.id);
    expect(personal.batches.map(batch => batch.length)).toEqual([12, 12, 12]);
    expect(new Set(personal.batches.flat().map(work => work.id)).size).toBe(36);
    for (const batch of personal.batches) {
      const directors = new Map<string, number>();
      batch.forEach(work => work.directors.forEach(person => directors.set(person, (directors.get(person) || 0) + 1)));
      expect(Math.max(...directors.values())).toBeLessThanOrEqual(2);
    }
    expect(buildHomeRecommendations(true, [], now, []).batches).toEqual(baseline.batches);
  });
});

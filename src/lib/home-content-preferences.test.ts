import { describe, expect, it } from 'vitest';
import { homeContentKinds, homeFeedbackFilter, suppressedHomeKinds } from './home-content-preferences';
import type { HomeFeedback, HomeContentKind } from './home-feedback-types';

const vote = (id: string, kind: HomeContentKind, value: 'like' | 'dislike' = 'dislike'): HomeFeedback => ({ workId: id, vote: value, updatedAt: 1, contentKinds: [kind] });
describe('format preferences', () => {
  it.each(['国产动漫', '日韩动漫', '動畫電影', '国漫', '番剧', '动态漫', 'animated movie', 'OVA'])('recognizes %s even when the source classifies it as a movie', genre => {
    expect(homeContentKinds({ mediaType: 'movie', genres: [genre] })).toEqual(['animation']);
  });
  it('recognizes source types and metadata without guessing from film titles or generic genres', () => {
    expect(homeContentKinds({ mediaType: 'short', genres: ['爱情'] })).toEqual(['short']);
    expect(homeContentKinds({ mediaType: 'tv', genres: ['微短劇'] })).toEqual(['short']);
    expect(homeContentKinds({ mediaType: 'movie', genres: [], metadata: { genre: '动画 / 奇幻' } })).toEqual(['animation']);
    expect(homeContentKinds({ mediaType: 'movie', genres: ['短片', '剧情', '爱情'] })).toEqual([]);
  });
  it('requires two distinct disliked works and keeps the two formats independent', () => {
    expect([...suppressedHomeKinds([vote('a', 'short')])]).toEqual([]);
    expect([...suppressedHomeKinds([vote('a', 'short'), vote('a', 'short')])]).toEqual([]);
    expect([...suppressedHomeKinds([vote('a', 'short'), vote('b', 'short'), vote('c', 'animation')])]).toEqual(['short']);
    expect([...suppressedHomeKinds([vote('a', 'short'), vote('b', 'short'), vote('c', 'animation'), vote('d', 'animation')])]).toEqual(['short', 'animation']);
  });
  it('uses current choices, permits explicitly liked exceptions, and releases suppression when feedback changes', () => {
    const items = [vote('a', 'animation'), vote('b', 'animation'), vote('favorite', 'animation', 'like')];
    const allowed = homeFeedbackFilter(items);
    expect(allowed({ id: 'unseen', mediaType: 'movie', genres: ['动画'] })).toBe(false);
    expect(allowed({ id: 'favorite', mediaType: 'animation', genres: [] })).toBe(true);
    expect(allowed({ id: 'live-action', mediaType: 'movie', genres: ['剧情'] })).toBe(true);
    expect(allowed({ id: 'short', mediaType: 'short', genres: [] })).toBe(true);
    expect([...suppressedHomeKinds(items.slice(1))]).toEqual([]);
    expect([...suppressedHomeKinds([...items, { ...vote('b', 'animation', 'like'), updatedAt: 2 }])]).toEqual([]);
  });
});

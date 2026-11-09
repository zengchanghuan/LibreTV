import { describe, expect, it } from 'vitest';
import { homeRecommendationQueryKey, optimisticHomeFeedback, visibleHomeRecommendationBatch } from './home-feedback-client';
import { buildHomeRecommendations } from './home-recommendations';
import type { HomeFeedbackResponse } from './home-feedback-types';

describe('immediate home feedback', () => {
  const daily = buildHomeRecommendations(true), target = daily.batches[0][0];
  const original: HomeFeedbackResponse = { items: [{ workId: target.id, vote: 'like', updatedAt: 1 }] };
  it('updates feedback immediately and preserves the snapshot for rollback', () => {
    const next = optimisticHomeFeedback(original, target.id, 'dislike', 2);
    expect(next.items).toEqual([{ workId: target.id, vote: 'dislike', updatedAt: 2 }]);
    expect(original.items).toEqual([{ workId: target.id, vote: 'like', updatedAt: 1 }]);
    expect(optimisticHomeFeedback(next, target.id, null).items).toEqual([]);
    expect(visibleHomeRecommendationBatch(daily, original.items, 0)).toEqual(daily.batches[0]);
  });
  it.each([0, 1, 2, 4])('fills the selected batch %s from the existing pool before a server response', index => {
    const selected = daily.batches[index % daily.batches.length], disliked = selected[0];
    const feedback = optimisticHomeFeedback({ items: [] }, disliked.id, 'dislike');
    const visible = visibleHomeRecommendationBatch(daily, feedback.items, index);
    expect(visible).toHaveLength(12);
    expect(visible.slice(0, 11)).toEqual(selected.slice(1));
    expect(visible.some(work => work.id === disliked.id)).toBe(false);
    expect(new Set(visible.map(work => work.id)).size).toBe(12);
  });
  it('does not duplicate or invent cards when the candidate pool runs out', () => {
    const next = optimisticHomeFeedback(original, target.id, 'dislike');
    expect(visibleHomeRecommendationBatch({ ...daily, batches: [[target], [target]] }, next.items, 0)).toEqual([]);
    expect(visibleHomeRecommendationBatch(undefined, next.items, 0)).toEqual([]);
  });
  it('applies a second format dislike before saving, skips that format in refill, and restores the old pool on rollback', () => {
    const first = { ...target, id: 'short-1', mediaType: 'short' as const }, second = { ...first, id: 'short-2' }, third = { ...first, id: 'short-3' };
    const previous: HomeFeedbackResponse = { items: [{ workId: first.id, vote: 'dislike', updatedAt: 1, contentKinds: ['short'] }] };
    const pool = { ...daily, batches: [[second, target], [third, daily.batches[0][1]]] };
    expect(visibleHomeRecommendationBatch(pool, previous.items, 0)[0]).toBe(second);
    const pending = optimisticHomeFeedback(previous, second.id, 'dislike', 2, ['short']);
    expect(visibleHomeRecommendationBatch(pool, pending.items, 0)).toEqual([target, daily.batches[0][1]]);
    expect(visibleHomeRecommendationBatch(pool, previous.items, 0)).toEqual([second, target]);
    expect(previous.items).toHaveLength(1);
  });
  it('isolates cache entries by account, filter, date and saved revision', () => {
    const key = homeRecommendationQueryKey('alice', true, original.items, daily.day);
    expect(homeRecommendationQueryKey('alice', true, original.items, daily.day)).toEqual(key);
    expect(homeRecommendationQueryKey('bob', true, original.items, daily.day)).not.toEqual(key);
    expect(homeRecommendationQueryKey('alice', false, original.items, daily.day)).not.toEqual(key);
    expect(homeRecommendationQueryKey('alice', true, original.items, '2026-01-01')).not.toEqual(key);
    expect(homeRecommendationQueryKey('alice', true, optimisticHomeFeedback(original, target.id, 'dislike').items, daily.day)).not.toEqual(key);
  });
});

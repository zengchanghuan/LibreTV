import { homeDay, type HomeRecommendations } from './home-discovery-types';
import type { HomeFeedback, HomeFeedbackResponse, HomeVote } from './home-feedback-types';

export function homeRecommendationQueryKey(username: string | null, filterAdult: boolean, items: HomeFeedback[], day = homeDay()) {
  return ['home-personal-recommendations', username, filterAdult, day,
    JSON.stringify(items.map(item => [item.workId, item.vote, item.updatedAt]))];
}

export function optimisticHomeFeedback(previous: HomeFeedbackResponse, workId: string, vote: HomeVote | null, now = Date.now()): HomeFeedbackResponse {
  return { items: [
    ...(vote ? [{ workId, vote, updatedAt: now }] : []),
    ...previous.items.filter(item => item.workId !== workId),
  ] };
}

/** Keep the current page full while the server saves and reranks the recommendation pool. */
export function visibleHomeRecommendationBatch(data: HomeRecommendations | undefined, feedback: HomeFeedback[], index: number) {
  const batches = data?.batches || [], current = batches[index % (batches.length || 1)] || [];
  const hidden = new Set(feedback.filter(item => item.vote === 'dislike').map(item => item.workId));
  const used = new Set<string>();
  return [...current, ...batches.flat()].filter(work => {
    if (hidden.has(work.id) || used.has(work.id)) return false;
    used.add(work.id); return true;
  }).slice(0, current.length);
}

import { homeDay, type HomeRecommendations } from './home-discovery-types';
import type { HomeContentKind, HomeFeedback, HomeFeedbackResponse, HomeVote } from './home-feedback-types';
import { homeFeedbackFilter } from './home-content-preferences';

export const homeFeedbackRevision = (items: HomeFeedback[]) => JSON.stringify(items.map(item => [item.workId, item.vote, item.updatedAt, item.contentKinds]));

export function homeRecommendationQueryKey(username: string | null, filterAdult: boolean, items: HomeFeedback[], day = homeDay()) {
  return ['home-personal-recommendations', username, filterAdult, day,
    homeFeedbackRevision(items)];
}

export function optimisticHomeFeedback(previous: HomeFeedbackResponse, workId: string, vote: HomeVote | null, now = Date.now(), contentKinds: HomeContentKind[] | undefined = previous.items.find(item => item.workId === workId)?.contentKinds): HomeFeedbackResponse {
  return { items: [
    ...(vote ? [{ workId, vote, updatedAt: now, ...(contentKinds?.length ? { contentKinds } : {}) }] : []),
    ...previous.items.filter(item => item.workId !== workId),
  ] };
}

/** Keep the current page full while the server saves and reranks the recommendation pool. */
export function visibleHomeRecommendationBatch(data: HomeRecommendations | undefined, feedback: HomeFeedback[], index: number) {
  const batches = data?.batches || [], current = batches[index % (batches.length || 1)] || [];
  const allowed = homeFeedbackFilter(feedback);
  const used = new Set<string>();
  return [...current, ...batches.flat()].filter(work => {
    if (!allowed(work) || used.has(work.id)) return false;
    used.add(work.id); return true;
  }).slice(0, current.length);
}

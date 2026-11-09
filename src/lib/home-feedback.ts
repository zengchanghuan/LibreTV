import { createHmac } from 'node:crypto';
import { discoveryTransaction } from './discovery-storage';
import { emptyDiscovery } from './discovery-catalog';
import { recommendationById, recommendationByTitle } from './recommendation-catalog';
import type { HomeFeedbackResponse, HomePreference, HomeVote } from './home-feedback-types';
import type { RecommendedWork } from './recommendations';
import { homeContentKinds } from './home-content-preferences';

interface FeedbackStore { version: 1; items: HomePreference[] }
const emptyFeedback = (): FeedbackStore => ({ version: 1, items: [] });
const MAX_FEEDBACK = 1000;

function normalizeFeedback(items: HomePreference[]) {
  const unique = new Map<string, HomePreference>();
  for (const item of items) {
    const known = recommendationById(item.workId) || (item.workId.startsWith('local:') ? recommendationByTitle(item.work.title, item.work.year) : undefined);
    const id = known?.id || item.workId;
    const normalized = id === item.workId ? item : { ...item, workId: id, work: { ...item.work, id } };
    if (!unique.has(id) || unique.get(id)!.updatedAt < item.updatedAt) unique.set(id, normalized);
  }
  return [...unique.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

function feedbackFile(account: string | null) {
  const secret = process.env.PROXY_SECRET || process.env.PASSWORD;
  if (!secret) throw new Error('喜好记录暂不可用');
  const actor = createHmac('sha256', secret).update(`home-feedback:${account || 'shared-password-account'}`).digest('hex');
  return `feedback-${actor}`;
}
export function readHomeFeedback(account: string | null): Promise<HomePreference[]> {
  return discoveryTransaction(feedbackFile(account), emptyFeedback, data => normalizeFeedback(data.items));
}
export function publicHomeFeedback(items: HomePreference[]): HomeFeedbackResponse {
  return { items: normalizeFeedback(items).map(({ workId, vote, updatedAt, work }) => {
    const contentKinds = homeContentKinds(work);
    return { workId, vote, updatedAt, ...(contentKinds.length ? { contentKinds } : {}) };
  }) };
}

/** Resolve identities/credits on the server; clients submit only an ID and a vote. */
export async function saveHomeFeedback(account: string | null, workId: string, vote: HomeVote | null, now = Date.now()) {
  workId = recommendationById(workId)?.id || workId;
  let work: RecommendedWork | undefined;
  if (vote) {
    const known = recommendationById(workId);
    const observed = await discoveryTransaction('catalog', emptyDiscovery, data => data.works.find(item => item.work.id === workId)?.work);
    work = known ? { ...known, mediaType: observed?.mediaType || known.mediaType,
      genres: [...new Set([...known.genres, ...observed?.genres || []])] } : observed;
  }
  return discoveryTransaction(feedbackFile(account), emptyFeedback, data => {
    data.items = normalizeFeedback(data.items);
    const previous = data.items.find(item => item.workId === workId);
    // Existing feedback remains editable even after a source leaves the recent catalog.
    const known = work || previous?.work;
    if (vote && !known) return null;
    data.items = data.items.filter(item => item.workId !== workId);
    if (vote && known) {
      const { id, title, year, mediaType, aliases, genres, directors, cast } = known;
      data.items.push({ workId, vote, updatedAt: now, work: { id, title, year, mediaType, aliases, genres, directors, cast } });
      data.items = data.items.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_FEEDBACK);
    }
    return publicHomeFeedback(data.items);
  }, true);
}

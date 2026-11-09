import type { HomeContentKind, HomeFeedback } from './home-feedback-types';
import type { RecommendedWork } from './recommendations';

type ClassifiedWork = Pick<RecommendedWork, 'mediaType' | 'genres'> & Pick<Partial<RecommendedWork>, 'metadata'>;

/** Format preferences span source labels; an animated movie is still animation for taste. */
export function homeContentKinds(work: ClassifiedWork): HomeContentKind[] {
  const labels = [...work.genres, work.metadata?.genre || ''].join(' / ');
  const kinds: HomeContentKind[] = [];
  if (work.mediaType === 'short' || /短剧|短劇|微剧|微劇|微短剧|微短劇|竖屏剧|豎屏劇|短尺ドラマ|short[\s_-]?drama/i.test(labels)) kinds.push('short');
  if (work.mediaType === 'animation' || /动漫|動漫|动画|動畫|卡通|国漫|國漫|日漫|韩漫|韓漫|番剧|番劇|动态漫|動態漫|漫剧|漫劇|animation|animated|anime|cartoon|\b(?:ova|oad)\b/i.test(labels)) kinds.push('animation');
  return kinds;
}

/** Repeated dislikes of a format are an exclusion, not a weak genre tie-breaker. */
export function suppressedHomeKinds(items: HomeFeedback[]): Set<HomeContentKind> {
  const latest = new Map<string, HomeFeedback>();
  for (const item of items) if (!latest.has(item.workId) || latest.get(item.workId)!.updatedAt < item.updatedAt) latest.set(item.workId, item);
  return new Set((['short', 'animation'] as const).filter(kind => {
    const votes = [...latest.values()].filter(item => item.contentKinds?.includes(kind));
    const dislikes = votes.filter(item => item.vote === 'dislike').length;
    return dislikes >= 2 && dislikes > votes.length - dislikes;
  }));
}

/** Shared by immediate client updates and server candidate selection, including refill. */
export function homeFeedbackFilter(items: HomeFeedback[]) {
  const suppressed = suppressedHomeKinds(items);
  const disliked = new Set(items.filter(item => item.vote === 'dislike').map(item => item.workId));
  const liked = new Set(items.filter(item => item.vote === 'like').map(item => item.workId));
  return (work: Pick<RecommendedWork, 'id'> & ClassifiedWork) => !disliked.has(work.id)
    && (liked.has(work.id) || !homeContentKinds(work).some(kind => suppressed.has(kind)));
}

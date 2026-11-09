import { genreSimilarity, sharedValues } from './content-similarity';
import { matchesWorkTitle } from './recommendations';
import type { RecommendedWork } from './recommendations';
import type { HomePreference } from './home-feedback-types';
import { homeContentKinds, homeFeedbackFilter } from './home-content-preferences';

export function samePreferenceWork(work: RecommendedWork, preference: HomePreference) {
  const other = preference.work;
  return work.id === preference.workId || (work.year === other.year
    && (work.mediaType === other.mediaType || work.mediaType === 'unknown' || other.mediaType === 'unknown')
    && (matchesWorkTitle(work, other.title) || matchesWorkTitle(other, work.title)));
}

export function homePreferenceFilter(preferences: HomePreference[]) {
  const formatAllowed = homeFeedbackFilter(preferences.map(item => ({ ...item, contentKinds: homeContentKinds(item.work) })));
  const disliked = preferences.filter(item => item.vote === 'dislike');
  return (work: RecommendedWork) => formatAllowed(work) && !disliked.some(item => samePreferenceWork(work, item));
}

/** Explicit votes outweigh editorial ordering; broad genre labels stay weak signals. */
export function homePreferenceScore(work: RecommendedWork, preferences: HomePreference[]) {
  let score = 0, strongest = 0, reason: string | undefined;
  for (const preference of preferences) {
    if (samePreferenceWork(work, preference)) continue;
    const other = preference.work;
    const directors = sharedValues(work.directors, other.directors), cast = sharedValues(work.cast, other.cast);
    const genre = genreSimilarity(work.genres, other.genres);
    const kinds = homeContentKinds(work).filter(kind => homeContentKinds(other).includes(kind));
    const affinity = (kinds.length ? 30 : 0) + (directors.length ? 60 : 0) + Math.min(30, cast.length * 15)
      + (genre.specific.length ? genre.score : Math.min(2, genre.score));
    score += affinity * (preference.vote === 'like' ? 1 : -1);
    if (preference.vote === 'like' && affinity > strongest) {
      strongest = affinity;
      reason = directors.length ? `你喜欢的导演 · ${directors[0]}` : cast.length ? `你喜欢的演员 · ${cast[0]}`
        : genre.specific.length ? `你喜欢的题材 · ${genre.specific.slice(0, 2).join(' / ')}`
          : kinds.length ? `你喜欢的类型 · ${kinds[0] === 'short' ? '短剧' : '动漫'}` : undefined;
    }
  }
  return { score, reason: score > 0 ? reason : undefined };
}

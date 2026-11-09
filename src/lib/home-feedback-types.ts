import type { RecommendedWork } from './recommendations';

export type HomeVote = 'like' | 'dislike';
export interface HomeFeedback {
  workId: string;
  vote: HomeVote;
  updatedAt: number;
}
export interface HomePreference extends HomeFeedback {
  work: Pick<RecommendedWork, 'id' | 'title' | 'year' | 'mediaType' | 'aliases' | 'genres' | 'directors' | 'cast'>;
}
export interface HomeFeedbackResponse { items: HomeFeedback[] }

export function nextHomeVote(current: HomeVote | undefined, clicked: HomeVote): HomeVote | null {
  return current === clicked ? null : clicked;
}

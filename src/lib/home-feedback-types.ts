import type { RecommendedWork } from './recommendations';
import type { HomeRecommendations } from './home-discovery-types';

export type HomeVote = 'like' | 'dislike';
export type HomeContentKind = 'short' | 'animation';
export interface HomeFeedback {
  workId: string;
  vote: HomeVote;
  updatedAt: number;
  contentKinds?: HomeContentKind[];
}
export interface HomePreference extends HomeFeedback {
  work: Pick<RecommendedWork, 'id' | 'title' | 'year' | 'mediaType' | 'aliases' | 'genres' | 'directors' | 'cast'>;
}
export interface HomeFeedbackResponse { items: HomeFeedback[] }
export interface HomeFeedbackUpdateResponse extends HomeFeedbackResponse { recommendations?: HomeRecommendations }

export function nextHomeVote(current: HomeVote | undefined, clicked: HomeVote): HomeVote | null {
  return current === clicked ? null : clicked;
}

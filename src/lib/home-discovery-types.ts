import type { RecommendedWork } from './recommendations';

export interface HomeCollection {
  id: string;
  name: string;
  intro: string;
  count: number;
  poster?: string;
}
export interface HomeRecommendations {
  day: string;
  version: string;
  generatedAt: string;
  expiresAt: string;
  batches: RecommendedWork[][];
  collections: HomeCollection[];
  aiStatus: 'pending' | 'ready' | 'fallback' | 'disabled';
}

/** Date boundaries must agree between browser, server and cache, regardless of host TZ. */
export function homeDay(now = Date.now()) {
  return new Date(now + 8 * 3600_000).toISOString().slice(0, 10);
}

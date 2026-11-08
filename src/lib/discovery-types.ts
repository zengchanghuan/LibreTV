import type { RecommendedWork } from './recommendations';

export type RecentTab = 'new' | 'series' | 'added';
export interface DiscoveryResource {
  sourceKey: string; sourceId: string; vodId: string;
  observedAt: number; firstSeenAt: number; updatedAt?: number;
  releaseDate?: string; releaseEvidence?: string;
  episodes: string[]; episodeCount: number; lastEpisodeAt?: number;
}
export interface DiscoveryWork { work: RecommendedWork; resources: DiscoveryResource[]; firstSeenAt: number }
export interface DiscoveryStore { version: 1; refreshedAt: number; attemptedAt: number; failures: number; works: DiscoveryWork[] }
export interface RecentCard { work: RecommendedWork; sourceCount: number; date: string; label: string }
export interface EditorialIssue { id: string; title: string; intro: string; publishedAt: string; works: RecommendedWork[] }
export interface DiscoveryResponse {
  recent: Record<RecentTab, RecentCard[]>;
  refreshedAt: string | null; stale: boolean; partial: boolean; loading: boolean;
  popular: RecommendedWork[]; popularStatus: 'ready' | 'collecting' | 'disabled' | 'unavailable';
  editorial: EditorialIssue[];
  enabled: { recent: boolean; popular: boolean; editorial: boolean };
}

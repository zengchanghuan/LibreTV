import starters from './discovery-starters.json';
import type { RecommendedWork } from './recommendations';
import type { EditorialIssue } from './discovery-types';

/** Small, bundled catalog snapshot: available before auth/API/network initialization. */
export const discoveryStarters = starters as RecommendedWork[];
export const starterEditorial: EditorialIssue = {
  id: 'starter-city-night', title: '当城市入夜', intro: '从街头的偶遇到无声的对峙，看城市里的人如何选择自己的路。',
  publishedAt: '', works: discoveryStarters.slice(0, 4),
};

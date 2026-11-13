import { correctSearchItem, sourceContentIssue } from './source-content-corrections';
import { classifyMediaType, type MediaType } from './media-type';
import { searchTitleKey } from './cms-parser';
import type { SearchResultItem } from './types';
import { searchResultIdentity } from './search-result-identity';

export interface AggregatedGroup {
  identityUnconfirmed?: boolean;
  identityReason?: string;
  key: string;
  name: string;
  year?: string;
  typeName?: string;
  mediaType: MediaType;
  pic?: string;
  remarks?: string;
  items: SearchResultItem[];
}

function buildGroup(name: string, year: string | undefined, mediaType: MediaType, items: SearchResultItem[]): AggregatedGroup {
  return {
    identityUnconfirmed: items.some(item => item.identityUnconfirmed) || undefined,
    identityReason: items.find(item => item.identityReason)?.identityReason,
    key: `${name}|${year ?? ''}|${mediaType}|${items.map((i) => `${i.sourceKey}_${i.vodId}`).join(',')}`,
    name,
    year,
    typeName: items.some(item => sourceContentIssue(item.sourceUrl, item.vodId)) ? undefined : items.map(i => i.identityDetails?.typeName || i.typeName).find(type => classifyMediaType(type) === mediaType && type),
    mediaType,
    pic: items.find((i) => i.pic)?.pic,
    remarks: items.find((i) => i.remarks)?.remarks,
    items,
  };
}

/** 同名/同季异写按内容类型和年份聚合，同名的电影与电视剧分别展示。 */
export function aggregateResults(list: SearchResultItem[]): AggregatedGroup[] {
  list = list.map(correctSearchItem);
  const identities = new Map(list.map(item => [item, searchResultIdentity(item)]));
  const byName = new Map<string, SearchResultItem[]>();
  for (const item of list) {
    const name = (item.name || '').trim();
    if (!name) continue;
    const resolved = identities.get(item)!;
    const identity = item.identityUnconfirmed ? `unconfirmed:${JSON.stringify([item.sourceKey, item.vodId])}`
      : resolved.work ? `work:${resolved.work.id}` : searchTitleKey(resolved.title);
    if (!byName.has(identity)) byName.set(identity, []);
    byName.get(identity)!.push(item);
  }
  const groups: AggregatedGroup[] = [];
  for (const items of byName.values()) {
    const first = identities.get(items[0])!;
    const name = items[0].identityUnconfirmed ? items[0].name.trim() : first.title;
    const years = [...new Set(items.map((i) => identities.get(i)!.year).filter(Boolean))] as string[];
    const byYear: [string | undefined, SearchResultItem[]][] = years.length > 1
      ? [...years, undefined].map((year) => [year, items.filter((i) => identities.get(i)!.year === year)])
      : [[years[0], items]];
    for (const [year, yearItems] of byYear) {
      const knownTypes = [...new Set(yearItems.map((i) => identities.get(i)!.mediaType).filter((t) => t !== 'unknown'))];
      const byType = new Map<MediaType, SearchResultItem[]>();
      for (const item of yearItems) {
        const type = identities.get(item)!.mediaType;
        // 同年只有一种已知类型时允许补齐分类；存在电影/剧集冲突时保持未知结果独立。
        const bucket = type === 'unknown' && knownTypes.length === 1 ? knownTypes[0] : type;
        if (!byType.has(bucket)) byType.set(bucket, []);
        byType.get(bucket)!.push(item);
      }
      for (const [mediaType, typedItems] of byType) {
        groups.push(buildGroup(name, year, mediaType, typedItems));
      }
    }
  }
  return groups;
}

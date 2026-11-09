import { classifyMediaType, type MediaType } from './media-type';
import { searchTitleKey } from './cms-parser';
import type { SearchResultItem } from './types';
import { getWork } from './work-catalog';

export interface AggregatedGroup {
  identityUnconfirmed?: boolean;
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
    key: `${name}|${year ?? ''}|${mediaType}|${items.map((i) => `${i.sourceKey}_${i.vodId}`).join(',')}`,
    name,
    year,
    typeName: items.find((i) => classifyMediaType(i.typeName) === mediaType && i.typeName)?.typeName
      || items.find((i) => i.typeName)?.typeName,
    mediaType,
    pic: items.find((i) => i.pic)?.pic,
    remarks: items.find((i) => i.remarks)?.remarks,
    items,
  };
}

/** 同名/同季异写按内容类型和年份聚合，同名的电影与电视剧分别展示。 */
export function aggregateResults(list: SearchResultItem[]): AggregatedGroup[] {
  const byName = new Map<string, SearchResultItem[]>();
  for (const item of list) {
    const name = (item.name || '').trim();
    if (!name) continue;
    const identity = item.identityUnconfirmed ? `unconfirmed:${item.sourceKey}:${item.vodId}`
      : item.workId && getWork(item.workId) ? `work:${item.workId}` : searchTitleKey(name);
    if (!byName.has(identity)) byName.set(identity, []);
    byName.get(identity)!.push(item);
  }
  const groups: AggregatedGroup[] = [];
  for (const items of byName.values()) {
    const name = (items[0].workId ? getWork(items[0].workId)?.title : undefined) || items[0].name.trim();
    const years = [...new Set(items.map((i) => i.year).filter(Boolean))] as string[];
    const byYear: [string | undefined, SearchResultItem[]][] = years.length > 1
      ? [...years, undefined].map((year) => [year, items.filter((i) => year ? i.year === year : !i.year)])
      : [[years[0], items]];
    for (const [year, yearItems] of byYear) {
      const knownTypes = [...new Set(yearItems.map((i) => classifyMediaType(i.typeName)).filter((t) => t !== 'unknown'))];
      const byType = new Map<MediaType, SearchResultItem[]>();
      for (const item of yearItems) {
        const type = classifyMediaType(item.typeName);
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

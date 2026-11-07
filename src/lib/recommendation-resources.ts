import { cmsRequestHeaders, isAdultContent, parseDetail } from './cms-parser';
import { fetchUpstream, getCache, setCache } from './fetch-utils';
import { classifyMediaType } from './media-type';
import { searchSource } from './search-source';
import { detailSite, siteAdapterFor } from './site-adapters/site-adapters';
import { resourceMatch, type RecommendedWork, type ResourceMatch, type WorkResourcesResponse } from './recommendations';
import type { SourceConfig } from './types';

export async function matchWorkSources(work: RecommendedWork, sources: SourceConfig[], filterAdult: boolean, signal: AbortSignal): Promise<WorkResourcesResponse> {
  const results: WorkResourcesResponse[] = new Array(sources.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, sources.length) }, async () => {
    while (next < sources.length) {
      signal.throwIfAborted();
      const index = next++, source = sources[index];
      const result: WorkResourcesResponse = { items: [], checked: 1, failures: [] };
      results[index] = result;
      if (filterAdult && source.isAdult) continue;
      const key = `work-resources:v1:${JSON.stringify([work.title, work.aliases, work.year, work.mediaType, source, filterAdult])}`;
      const cached = getCache<ResourceMatch[]>(key);
      if (cached) { result.items = cached; continue; }
      // Six sources in a three-worker batch fit inside the route's 25 second budget.
      const sourceSignal = AbortSignal.any([signal, AbortSignal.timeout(10000)]);
      let incomplete = false;
      try {
        // A second known title is only queried when the primary title has no valid match.
        for (const title of [...new Set([work.title, ...work.aliases])].slice(0, 2)) {
          const outcome = await searchSource(source, title, { signal: sourceSignal, maxPages: 1, timeoutMs: 5000 });
          sourceSignal.throwIfAborted();
          if (!outcome.ok) throw new Error(outcome.error || '源搜索失败');
          const needsDetail = (item: ResourceMatch) => resourceMatch(work, item) === 'detail' || classifyMediaType(item.typeName) === 'unknown';
          const candidates = outcome.list.filter(item => resourceMatch(work, item) !== 'reject')
            .sort((a, b) => Number(needsDetail(a)) - Number(needsDetail(b)));
          let detailLookups = 0;
          for (const item of candidates) {
            if (filterAdult && (item.isAdult || isAdultContent(item.typeName) || /情色/.test(item.typeName || ''))) continue;
            let resolved = item;
            if (needsDetail(item)) {
              if (detailLookups >= 3) continue;
              detailLookups++;
              try {
                let detail;
                if (siteAdapterFor(source.url)) detail = await detailSite(source, item.vodId, sourceSignal);
                else {
                  const target = new URL(source.url);
                  for (const name of ['ac', 'ids', 'wd', 'pg', 't']) target.searchParams.delete(name);
                  target.searchParams.set('ac', 'videolist'); target.searchParams.set('ids', item.vodId);
                  const response = await fetchUpstream(target.href, { headers: cmsRequestHeaders(), signal: sourceSignal, timeoutMs: 5000 });
                  if (!response.ok) throw new Error('资源资料读取失败');
                  detail = parseDetail(await response.json(), source);
                }
                const info = detail.videoInfo;
                resolved = { ...item, name: info.title || item.name, year: info.year || item.year, typeName: info.typeName || item.typeName };
              } catch {
                sourceSignal.throwIfAborted();
                incomplete = true;
                continue;
              }
            }
            if (filterAdult && (isAdultContent(resolved.typeName) || /情色/.test(resolved.typeName || ''))) continue;
            if (resourceMatch(work, resolved) !== 'match') continue;
            result.items.push({ ...resolved, typeUnconfirmed: work.mediaType === 'unknown' || classifyMediaType(resolved.typeName) === 'unknown' });
          }
          if (result.items.length) break;
        }
        if (incomplete) result.failures.push({ sourceKey: source.key, error: '部分资源资料读取失败，可重试' });
        else setCache(key, result.items, result.items.length ? 10 * 60_000 : 30_000);
      } catch {
        signal.throwIfAborted();
        result.failures.push({ sourceKey: source.key, error: '该源查询未完成，可重试' });
      }
    }
  }));
  const seen = new Set<string>();
  return { items: results.flatMap(r => r.items).filter(item => {
    const key = JSON.stringify([item.sourceUrl, item.vodId]);
    if (seen.has(key)) return false; seen.add(key); return true;
  }), checked: results.length, failures: results.flatMap(r => r.failures) };
}

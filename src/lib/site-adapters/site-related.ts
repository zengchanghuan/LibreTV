import { load } from 'cheerio';
import { getCache, setCache } from '@/lib/fetch-utils';
import { relatedTitle, rankRelatedVideos, seriesQuery, type RelatedCandidate } from '@/lib/related-videos';
import type { RelatedVideosResponse, SourceConfig, VideoDetail } from '@/lib/types';
import { fourkHtml, parseFourKDetail, parseFourKSearch, searchSite, siteAdapterFor, validSiteId } from './site-adapters';
import { bpRelated } from './baipiaozhe';

/** Scope to the site's actual related section, excluding navigation, ads and episode links. */
export function parseFourKRelated(html: string, source: SourceConfig) {
  const $ = load(html);
  const heading = $('h2').filter((_, element) => $(element).text().trim() === '相关推荐').first();
  return parseFourKSearch(heading.parent().next('div.grid').html() || '', source);
}

function candidate(id: string, detail: VideoDetail): RelatedCandidate {
  const info = detail.videoInfo;
  return { ...info, vodId: id, name: info.title || '', pic: info.cover };
}

async function fourkRelated(source: SourceConfig, id: string, filterAdult: boolean, signal: AbortSignal): Promise<RelatedVideosResponse> {
  const html = await fourkHtml(`/play/${id}`, signal);
  const seed = candidate(id, parseFourKDetail(html, source));
  const nativeCandidates = parseFourKRelated(html, source);
  const keyword = seriesQuery(seed.name);
  let partial = false;
  // Series results are first so the bounded metadata lookups do not crowd out sequels.
  const series = keyword ? await searchSite(source, keyword, signal).catch((error: unknown) => {
    signal.throwIfAborted();
    if (!nativeCandidates.length) throw error;
    partial = true;
    return [];
  }) : [];
  const seen = new Set<string>();
  const candidates = [...series, ...nativeCandidates].filter((item) => {
    if (!validSiteId(item.vodId) || item.vodId === id || relatedTitle(item.name) === relatedTitle(seed.name) || seen.has(item.vodId)) return false;
    seen.add(item.vodId);
    return true;
  }).slice(0, 8);
  if (!candidates.length) return { items: [], partial };

  const enriched: RelatedCandidate[] = [];
  let succeeded = 0;
  // HTML cards lack genres/people. Fetch metadata with at most 3 simultaneous requests;
  // do not label an unrelated source carousel as a content match without this evidence.
  for (let offset = 0; offset < candidates.length; offset += 3) {
    signal.throwIfAborted();
    const results = await Promise.allSettled(candidates.slice(offset, offset + 3).map(async (item) => {
      const key = `fourk-related-detail:${JSON.stringify([source, item.vodId])}`;
      let detail = getCache<VideoDetail>(key);
      if (!detail) {
        detail = parseFourKDetail(await fourkHtml(`/play/${item.vodId}`, signal), source);
        setCache(key, detail, 5 * 60_000);
      }
      return { ...candidate(item.vodId, detail), isAdult: source.isAdult };
    }));
    for (const result of results) {
      if (result.status === 'fulfilled') { enriched.push(result.value); succeeded++; }
      else partial = true;
    }
    if (signal.aborted && succeeded) break;
  }
  if (!succeeded) throw new Error('相关推荐元数据加载失败');
  return { items: rankRelatedVideos(seed, enriched, filterAdult), partial };
}

export async function relatedSite(source: SourceConfig, id: string, filterAdult: boolean, signal: AbortSignal): Promise<RelatedVideosResponse> {
  if (!validSiteId(id)) throw new Error('无效的影片编号');
  const site = siteAdapterFor(source.url);
  if (site === '4kvm') return fourkRelated(source, id, filterAdult, signal);
  if (site === 'baipiaozhe') return bpRelated(source, id, filterAdult, signal);
  throw new Error('未识别的网页片源');
}

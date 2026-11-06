import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { cmsRequestHeaders } from '@/lib/cms-parser';
import { fetchUpstream, getCache, setCache } from '@/lib/fetch-utils';
import { checkUpstreamAllowed } from '@/lib/ssrf';
import { siteAdapterFor } from '@/lib/site-adapters/site-adapters';
import { relatedSite } from '@/lib/site-adapters/site-related';
import { parseRelatedCandidates, rankRelatedVideos, seriesQuery } from '@/lib/related-videos';
import type { RelatedVideosResponse, SourceConfig } from '@/lib/types';

export const runtime = 'nodejs';
const respond = (data: object, status = 200) =>
  NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;
  const params = new URL(req.url).searchParams;
  const id = params.get('id') || '';
  let source: SourceConfig;
  try {
    const raw = JSON.parse(params.get('source') || 'null');
    if (!raw || typeof raw.key !== 'string' || typeof raw.name !== 'string'
      || typeof raw.url !== 'string' || raw.url.length > 2048 || !/^https?:\/\//.test(raw.url)
      || !/^[\w-]{1,512}$/.test(id)) return respond({ error: '无效的影片或点播源' }, 400);
    source = { key: raw.key, name: raw.name, url: raw.url, isAdult: raw.isAdult === true };
  } catch {
    return respond({ error: '无效的影片或点播源' }, 400);
  }
  const filterAdult = params.get('filterAdult') !== 'false';
  const site = siteAdapterFor(source.url);
  if (filterAdult && source.isAdult) return respond({ items: [] });

  try {
    const verdict = await checkUpstreamAllowed(source.url);
    if (!verdict.ok) return respond({ error: verdict.reason }, 400);
    // Include source identity: cached cards must keep the caller's playable source key.
    const cacheKey = `related:v2:${JSON.stringify([source, id, filterAdult])}`;
    const cached = getCache<RelatedVideosResponse>(cacheKey);
    if (cached) return respond(cached);
    const signal = AbortSignal.any([req.signal, AbortSignal.timeout(site ? 20_000 : 10_000)]);
    if (site) {
      const payload = await relatedSite(source, id, filterAdult, signal);
      if (!payload.partial) setCache(cacheKey, payload, 5 * 60_000);
      return respond(payload);
    }
    const load = async (query: Record<string, string>) => {
      const target = new URL(source.url);
      for (const key of ['ac', 'ids', 'wd', 't', 'pg']) target.searchParams.delete(key);
      target.searchParams.set('ac', 'videolist');
      for (const [key, value] of Object.entries(query)) target.searchParams.set(key, value);
      const response = await fetchUpstream(target.href, { headers: cmsRequestHeaders(), signal, timeoutMs: 6000 });
      if (!response.ok) throw new Error('推荐源暂时不可用');
      return parseRelatedCandidates(await response.json(), source);
    };
    const seed = (await load({ ids: id })).find((item) => item.vodId === id);
    if (!seed) return respond({ error: '未找到当前影片的信息' }, 404);
    const queries: Record<string, string>[] = [];
    if (seed.typeId && /^[\w-]+$/.test(seed.typeId)) {
      queries.push({ t: seed.typeId, pg: '1' }, { t: seed.typeId, pg: '2' });
    }
    const wd = seriesQuery(seed.name);
    if (wd) queries.push({ wd, pg: '1' });
    if (!queries.length) return respond({ items: [] });
    // At most 4 upstream requests (seed + 2 category pages + 1 series query).
    const results = await Promise.allSettled(queries.map(load));
    const successful = results.filter((result) => result.status === 'fulfilled');
    if (!successful.length) return respond({ error: '相关推荐加载失败，请稍后重试' }, 502);
    const partial = successful.length !== results.length;
    const payload: RelatedVideosResponse = {
      items: rankRelatedVideos(seed, successful.flatMap((result) => result.value), filterAdult),
      partial,
    };
    // Do not cache incomplete upstream responses; a retry should really retry failed pages.
    if (!partial) setCache(cacheKey, payload, 5 * 60_000);
    return respond(payload);
  } catch {
    return respond({ error: '相关推荐加载失败，请稍后重试' }, 502);
  }
}

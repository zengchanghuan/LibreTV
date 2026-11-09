import { cmsRequestHeaders, parseDetail } from './cms-parser';
import { fetchUpstream } from './fetch-utils';
import { detailSite, siteAdapterFor } from './site-adapters/site-adapters';
import type { SourceConfig } from './types';

/** Metadata only: no playback probing, all upstream redirects retain SSRF validation. */
export async function readSourceVideoDetails(source: SourceConfig, id: string, signal: AbortSignal, timeoutMs = 2500) {
  if (siteAdapterFor(source.url)) return (await detailSite(source, id, signal)).videoInfo;
  const target = new URL(source.url);
  for (const name of ['ac', 'ids', 'wd', 't', 'pg']) target.searchParams.delete(name);
  target.searchParams.set('ac', 'videolist'); target.searchParams.set('ids', id);
  const response = await fetchUpstream(target.href, { headers: cmsRequestHeaders(), signal, timeoutMs });
  if (!response.ok) throw new Error('资源资料读取失败');
  return parseDetail(await response.json(), source).videoInfo;
}

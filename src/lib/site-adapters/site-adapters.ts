import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import { fetchUpstream, getCache, setCache } from '@/lib/fetch-utils';
import { checkUpstreamAllowed } from '@/lib/ssrf';
import type { SearchResultItem, SourceConfig, VideoDetail } from '@/lib/types';
import { buildFourKRequest } from './fourk-wasm';
import { bpDetail, bpSearch, bpPlayback } from './baipiaozhe';

export type SiteAdapter = '4kvm' | 'baipiaozhe';
export type SitePlayback = { url: string; type: 'm3u8' | 'mp4' };
const FOURK = 'https://www.4kvm.tv';
const WASM_PATH = '/static/wasm/nbmovie_wasm_bg.d5d51939.wasm';
const WASM_SHA256 = 'd5d51939038a02b535ada73157fe845a46c7fc8e0d1aca7fc8b652f01a3fc10c';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36';

/** Match only root URLs: lookalike hosts and arbitrary paths remain ordinary CMS sources. */
export function siteAdapterFor(raw: string): SiteAdapter | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.port || u.username || u.password || u.search || u.hash || u.pathname !== '/') return null;
    if (['4kvm.tv', 'www.4kvm.tv'].includes(u.hostname)) return '4kvm';
    if (['baipiaozhe.ai', 'www.baipiaozhe.ai'].includes(u.hostname)) return 'baipiaozhe';
  } catch { /* invalid source */ }
  return null;
}
export function siteEpisode(site: SiteAdapter, id: string): string {
  return `/api/site-playback?site=${site}&id=${encodeURIComponent(id)}`;
}
export function validSiteId(id: string): boolean { return /^[\w-]{1,512}$/.test(id); }
export function resultBase(source: SourceConfig) {
  return { sourceKey: source.key, sourceName: source.name, sourceUrl: source.url, isAdult: !!source.isAdult };
}
async function fourkHtml(path: string, signal?: AbortSignal) {
  const res = await fetchUpstream(FOURK + path, { signal, timeoutMs: 15000, headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`4K影视请求失败（${res.status}）`);
  const text = await res.text();
  if (text.length > 3_000_000) throw new Error('4K影视响应过大');
  return text;
}
export function parseFourKSearch(html: string, source: SourceConfig): SearchResultItem[] {
  const $ = load(html), seen = new Set<string>();
  const results: SearchResultItem[] = [];
  $('a[data-vod][href^="/play/"]').each((_, element) => {
    const a = $(element), id = (a.attr('href') || '').split('/')[2];
    const name = a.find('h3').first().text().trim() || a.find('img').attr('alt') || '';
    if (!id || !validSiteId(id) || !name || seen.has(id)) return;
    seen.add(id);
    const image = a.find('img').first();
    const text = a.text();
    results.push({ ...resultBase(source), vodId: id, name, pic: image.attr('data-src') || image.attr('src'),
      year: text.match(/\b(?:19|20)\d{2}\b/)?.[0], remarks: '4K影视' });
  });
  return results;
}
export function parseFourKDetail(html: string, source: SourceConfig): VideoDetail {
  const $ = load(html), seen = new Set<string>(), episodes: string[] = [];
  // Multiple lines repeat episodes. Keep the first available line in the site's display order.
  const first = $('a[data-line][data-episode][dataid]').first().attr('data-line');
  $('a[data-line][data-episode][dataid]').each((_, element) => {
    const a = $(element), id = (a.attr('href') || '').match(/^\/play\/([\w-]+)$/)?.[1];
    if (a.attr('data-line') !== first || !id || seen.has(id)) return;
    seen.add(id); episodes.push(siteEpisode('4kvm', id));
  });
  if (!episodes.length) throw new Error('4K影视未找到可播放剧集');
  return { episodes, videoInfo: { ...resultBase(source),
    title: ($('meta[property="og:title"]').attr('content') || $('h1').first().text()).replace(/\s*-\s*第\d+集\s*$/, '').trim(),
    cover: $('meta[property="og:image"]').attr('content'), desc: $('meta[property="og:description"]').attr('content') } };
}
export async function searchSite(source: SourceConfig, keyword: string, signal?: AbortSignal) {
  if (siteAdapterFor(source.url) === 'baipiaozhe') return bpSearch(source, keyword, signal);
  return parseFourKSearch(await fourkHtml(`/search?q=${encodeURIComponent(keyword)}`, signal), source);
}
export async function detailSite(source: SourceConfig, id: string, signal?: AbortSignal) {
  if (!validSiteId(id)) throw new Error('无效的影片编号');
  if (siteAdapterFor(source.url) === 'baipiaozhe') return bpDetail(source, id, signal);
  return parseFourKDetail(await fourkHtml(`/play/${id}`, signal), source);
}
let wasmModule: Promise<WebAssembly.Module> | undefined;
function getWasm() {
  if (!wasmModule) wasmModule = (async () => {
    const res = await fetchUpstream(FOURK + WASM_PATH, { timeoutMs: 15000 });
    if (!res.ok) throw new Error('4K影视播放模块获取失败');
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength > 300_000 || createHash('sha256').update(Buffer.from(bytes)).digest('hex') !== WASM_SHA256)
      throw new Error('4K影视播放模块已变化，需要更新适配器');
    return WebAssembly.compile(bytes);
  })().catch(error => { wasmModule = undefined; throw error; });
  return wasmModule;
}
export function selectFourKPlayback(data: unknown): SitePlayback {
  const payload = data as { code?: number; data?: { quality_urls?: { url?: string; locked?: boolean; isvip?: boolean; mtype?: string }[] } };
  const item = payload.code === 200 ? payload.data?.quality_urls?.find(q => !q.locked && !q.isvip && /^https:\/\//.test(q.url || '')) : undefined;
  if (!item?.url) throw new Error('4K影视没有可用的游客线路，请换源');
  return { url: item.url, type: item.mtype === 'mp4' ? 'mp4' : 'm3u8' };
}
async function fourkPlayback(id: string, signal?: AbortSignal): Promise<SitePlayback> {
  const html = await fourkHtml(`/play/${id}`, signal), pageTime = String(Date.now()), $ = load(html);
  const dataId = $(`a[href="/play/${id}"][dataid]`).first().attr('dataid');
  const serverTime = $('meta#nb-st').attr('content'), userLink = html.match(/userlink:'([^']{1,256})'/)?.[1];
  if (!dataId || !serverTime || !userLink) throw new Error('4K影视播放页面格式已变化');
  const path = buildFourKRequest(await getWasm(), { dataId, slug: id, serverTime, pageTime, userLink });
  const res = await fetchUpstream(FOURK + path, { signal, timeoutMs: 20000, headers: { 'User-Agent': UA, Referer: `${FOURK}/play/${id}` } });
  if (!res.ok) throw new Error(`4K影视播放解析失败（${res.status}）`);
  return selectFourKPlayback(await res.json());
}
export async function resolveSitePlayback(site: SiteAdapter, id: string, signal?: AbortSignal): Promise<SitePlayback> {
  if (!validSiteId(id)) throw new Error('无效的剧集编号');
  const key = `site-play:${site}:${id}`, cached = getCache<SitePlayback>(key);
  if (cached) return cached;
  const result = await (site === '4kvm' ? fourkPlayback(id, signal) : bpPlayback(id, signal));
  const verdict = await checkUpstreamAllowed(result.url);
  if (!verdict.ok) throw new Error('播放地址未通过安全校验');
  setCache(key, result, 60_000);
  return result;
}

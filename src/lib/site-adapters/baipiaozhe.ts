import { createHash, createHmac, randomBytes } from 'node:crypto';
import { fetchUpstream, getCache, setCache } from '@/lib/fetch-utils';
import { checkUpstreamAllowed } from '@/lib/ssrf';
import type { SearchResultItem, SourceConfig, VideoDetail } from '@/lib/types';
import { resultBase, siteEpisode, validSiteId, type SitePlayback } from './site-adapters';
const ORIGIN = 'https://baipiaozhe.ai';
type Episode = { id: string; token?: string };
type Card = { id: string; title: string; poster_url?: string; year?: number; content_kind?: string; area?: string; remarks?: string; description?: string; actors?: string[]; directors?: string[]; episodes?: Episode[]; episode_pagination?: { has_more?: boolean; returned_count?: number }; availability?: { playable?: boolean; disabled?: boolean } };
type Line = { url?: string; url_kind?: string; label?: string; resolve_mode?: string; resolve_required?: boolean; minimum_user_level?: number; required_tokens?: number };
let session: { cookie: string; expires: number } | undefined;
let sessionPending: Promise<void> | undefined;
let keyPending: Promise<string> | undefined;

async function signingKey(): Promise<string> {
  const cached = getCache<string>('bp-public-client-key'); if (cached) return cached;
  if (!keyPending) keyPending = (async () => {
    const home = await fetchUpstream(ORIGIN, { timeoutMs: 8000 });
    if (!home.ok) throw new Error('白嫖者网站暂不可用');
    const html = await home.text();
    const asset = html.match(/(?:src|href)="(\/assets\/movie-card-runtime-[\w-]+\.js)"/)?.[1];
    if (!asset) throw new Error('白嫖者客户端已变化，需要更新适配器');
    const res = await fetchUpstream(ORIGIN + asset, { timeoutMs: 8000 });
    if (!res.ok) throw new Error('白嫖者客户端加载失败');
    const js = await res.text();
    // Read the public request-signing constant as data; never evaluate downloaded JavaScript.
    const key = js.match(/="([a-f0-9]{64})"\.trim\(\)/)?.[1];
    if (!key) throw new Error('白嫖者请求格式已变化，需要更新适配器');
    setCache('bp-public-client-key', key, 3600_000); return key;
  })().finally(() => { keyPending = undefined; });
  return keyPending;
}
function anonymousId() {
  const explicit = process.env.BAIPIAOZHE_ANONYMOUS_ID;
  if (explicit && /^web_[\w-]{16,80}$/.test(explicit)) return explicit;
  const secret = process.env.PROXY_SECRET;
  if (!secret) throw new Error('请配置 PROXY_SECRET 以保存白嫖者游客身份');
  const hash = createHash('sha256').update(`baipiaozhe:${secret}`).digest('hex');
  return `web_${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20,32)}`;
}
class BPError extends Error { constructor(public status: number) {
  super(status === 429 ? '白嫖者请求过于频繁，请稍后重试' : [402,403].includes(status) ? '白嫖者游客权限或额度不足，请换源' : `白嫖者请求失败（${status}）`);
} }
async function rawRequest(path: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
  if (!path.startsWith('/v1/')) throw new Error('无效的白嫖者接口');
  const key = await signingKey(), method = body === undefined ? 'GET' : 'POST';
  const timestamp = String(Date.now()), nonce = randomBytes(16).toString('hex');
  const signature = createHmac('sha256', key).update(`${method}\n${path}\n${timestamp}\n${nonce}`).digest('hex');
  const verdict = await checkUpstreamAllowed(ORIGIN + path);
  if (!verdict.ok) throw new Error('白嫖者接口未通过安全校验');
  // Never forward the visitor session to a redirect destination.
  const res = await fetchUpstream(ORIGIN + path, { method, signal, timeoutMs: 15000, safeRedirects: false, redirect: 'error',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Origin: ORIGIN, Referer: ORIGIN + '/',
      'x-ai-movie-timestamp': timestamp, 'x-ai-movie-nonce': nonce, 'x-ai-movie-signature': signature,
      ...(session?.cookie ? { Cookie: session.cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!res.ok) throw new BPError(res.status);
  return res;
}
async function ensureSession() {
  if (session && session.expires > Date.now()) return;
  if (!sessionPending) sessionPending = (async () => {
    const res = await rawRequest('/v1/users/anonymous', { anonymous_id: anonymousId() });
    const cookie = res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    await res.body?.cancel();
    if (!cookie) throw new Error('白嫖者游客会话创建失败');
    session = { cookie, expires: Date.now() + 30 * 60_000 };
  })().finally(() => { sessionPending = undefined; });
  await sessionPending;
}
async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  await ensureSession();
  try { return await (await rawRequest(path, undefined, signal)).json() as T; }
  catch (error) {
    if (!(error instanceof BPError) || error.status !== 401) throw error;
    session = undefined; await ensureSession(); // Renew the SAME identity, never rotate to bypass limits.
    return await (await rawRequest(path, undefined, signal)).json() as T;
  }
}
export function parseBPSearch(cards: Card[], source: SourceConfig): SearchResultItem[] {
  return cards.filter(c => validSiteId(c.id || '') && c.title && c.content_kind !== 'adult' && c.availability?.playable !== false && !c.availability?.disabled)
    .map(c => ({ ...resultBase(source), vodId: c.id, name: c.title, pic: c.poster_url, year: c.year ? String(c.year) : undefined,
      typeName: c.content_kind, area: c.area, remarks: c.remarks }));
}
export async function bpSearch(source: SourceConfig, keyword: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ q: keyword, intent: 'catalog_search', scenario: 'search_discovery', playable: 'true', page: '1', limit: '50' });
  const data = await request<{ cards: Card[] }>(`/v1/browse/catalog?${params}`, signal);
  if (!Array.isArray(data.cards)) throw new Error('白嫖者搜索返回格式异常');
  return parseBPSearch(data.cards, source);
}
export async function bpDetail(source: SourceConfig, id: string, signal?: AbortSignal): Promise<VideoDetail> {
  const data = await request<Card>(`/v1/catalog/${id}`, signal);
  const episodes = [...(data.episodes || [])];
  let more = data.episode_pagination?.has_more;
  for (let page = 0; more && page < 20; page++) {
    const next = await request<{ episodes: Episode[]; episode_pagination?: { has_more?: boolean } }>(`/v1/catalog/${id}/episodes?offset=${episodes.length}&limit=100`, signal);
    if (!next.episodes?.length) break;
    episodes.push(...next.episodes); more = next.episode_pagination?.has_more;
  }
  const ids = [...new Set(episodes.map(e => e.token).filter((t): t is string => !!t && validSiteId(t)))];
  if (!ids.length) throw new Error('白嫖者没有可播放剧集');
  return { episodes: ids.map(t => siteEpisode('baipiaozhe', t)), videoInfo: { ...resultBase(source), title: data.title,
    cover: data.poster_url, desc: data.description, area: data.area, year: data.year ? String(data.year) : undefined,
    actor: data.actors?.join(' / '), director: data.directors?.join(' / '), remarks: data.remarks } };
}
export function selectBPPlayback(lines: Line[]): SitePlayback {
  // Direct visitor lines do not require a paid resolver or a higher account level.
  const direct = lines.filter(l => !l.resolve_required && l.resolve_mode !== 'parse' && !(l.minimum_user_level && l.minimum_user_level > 0)
    && !(l.required_tokens && l.required_tokens > 0) && /^https?:\/\//.test(l.url || ''));
  const preferred = direct.find(l => l.label?.includes('360资源')) || direct.find(l => l.label?.includes('魔都资源')) || direct[0];
  if (!preferred?.url) throw new Error('白嫖者没有可用的游客直连线路，请换源');
  return { url: preferred.url, type: preferred.url_kind === 'mp4' || /\.mp4(?:\?|$)/i.test(preferred.url) ? 'mp4' : 'm3u8' };
}
export async function bpPlayback(token: string, signal?: AbortSignal): Promise<SitePlayback> {
  const data = await request<{ line_options?: Line[] }>(`/v1/playback/resolve/${token}?view=compact`, signal);
  return selectBPPlayback(data.line_options || []);
}

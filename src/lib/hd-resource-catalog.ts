import { load } from 'cheerio';
import { checkUpstreamAllowed } from './ssrf';
import { getCache, setCache } from './fetch-utils';
import { hdResourceSite, type HDResourceSiteId, type HDResourceCatalog, type HDResourceDetail, type HDResourceLink } from './hd-resource-sites';

export class HDResourceUnavailableError extends Error {
  constructor(message: string, readonly status: number = 502) { super(message); }
}
const YINFANS_CLOSED = '银盘（音范丝）原站已发布正式关停公告，当前域名不再提供影片目录和资源详情。';

/** Preserve diagnostic causes through Node fetch/AggregateError wrappers. */
export function resourceConnectionError(site: HDResourceSiteId, error: unknown): Error {
  const pending: unknown[] = [error]; const seen = new Set<unknown>(); const codes = new Set<string>();
  while (pending.length && seen.size < 16) {
    const value = pending.shift(); if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    const item = value as { code?: string; cause?: unknown; errors?: unknown[] };
    if (typeof item.code === 'string') codes.add(item.code);
    if (item.cause) pending.push(item.cause);
    if (Array.isArray(item.errors)) pending.push(...item.errors.slice(0, 8));
  }
  if ([...codes].some(code => /CERT|TLS|SSL/.test(code))) return new HDResourceUnavailableError(
    `${hdResourceSite(site)!.name}的 HTTPS 证书异常，暂时无法建立可信连接`);
  if (codes.has('ECONNRESET')) return new HDResourceUnavailableError(`${hdResourceSite(site)!.name}中断了服务器连接，请稍后重试`);
  if (error instanceof Error && /fetch failed|abort|timeout/i.test(error.message)) return new HDResourceUnavailableError('源站连接失败或超时，请稍后重试');
  return error instanceof Error ? error : new HDResourceUnavailableError('资源目录暂不可用');
}

const text = (value: string) => value.replace(/\s+/g, ' ').trim();
const absoluteUrl = (raw: string, base: string) => { try { return new URL(raw, base).href; } catch { return ''; } };
const UA = 'Mozilla/5.0 (compatible; HomeTV/1.0)';

/** Restrict both request URLs and every redirect to the selected site's known paths. */
export function resourcePageUrl(site: HDResourceSiteId, raw: string, detail: boolean): string | null {
  try {
    if (!raw) return null;
    const base = hdResourceSite(site)!.url;
    const url = new URL(raw, base);
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash) return null;
    if (url.hostname.replace(/^www\./, '') !== new URL(base).hostname.replace(/^www\./, '')) return null;
    let valid = false;
    if (site === 'rrdynb') {
      valid = detail
        ? /^\/(movie|dianshiju|zongyi|dongman)\/\d{4}\/\d{4}\/\d+\.html$/.test(url.pathname) && !url.search ||
          url.pathname === '/plus/view.php' && /^\?aid=\d{1,9}$/.test(url.search)
        : /^\/(?:index\.html|(?:movie|dianshiju|zongyi|dongman)\/(?:list_\d+_\d+\.html)?)?$/.test(url.pathname) && !url.search;
    } else if (site === '1lou') {
      valid = (detail ? /^\/thread-\d{1,9}\.htm$/ : /^\/(?:index(?:-\d{1,5})?\.htm|forum-[1-4]-\d{1,5}\.htm)?$/).test(url.pathname) && !url.search;
    } else if (site === 'yinfans') {
      valid = (detail ? /^\/movie\/\d{1,9}\/?$/ : /^\/(?:page\/\d{1,5}\/?|index\.html)?$/).test(url.pathname) && !url.search;
    } else {
      // Verified HDzone routes; keep search, user endpoints and arbitrary queries out.
      valid = detail ? /^\/t\/\d{1,9}$/.test(url.pathname) && !url.search
        : url.pathname === '/' && (!url.search || /^\?page=[1-9]\d{0,4}$/.test(url.search));
    }
    return valid ? url.href : null;
  } catch { return null; }
}

export function parseResourceCatalog(site: HDResourceSiteId, html: string, pageUrl: string): HDResourceCatalog {
  const $ = load(html), items: HDResourceCatalog['items'] = [], seen = new Set<string>();
  const selector = site === 'rrdynb' ? '.stui-vodlist__box, .intro' : site === '1lou' ? '.subject a.text-title[href]' : site === 'hdzu' ? '#index-topic .movie-item .topic-title a[href]' : 'h2 a[href], h3 a[href]';
  $(selector).each((_, el) => {
    if (items.length >= 80) return;
    const box = $(el), link = site === 'rrdynb' ? box.find('h2 a[href], h4 a[href], .title a[href]').first() : box;
    const url = resourcePageUrl(site, absoluteUrl(link.attr('href') || '/', pageUrl), true);
    if (site === '1lou' && !/电影|剧集|动漫|纪录/.test(box.closest('.subject').children('a[title]').first().attr('title') || '')) return;
    const title = text(link.attr('title') || link.text()).slice(0, 250);
    if (!url || !title || seen.has(url)) return;
    seen.add(url);
    const note = site === 'rrdynb' ? text(box.find('.brief, .text-muted').text())
      : site === 'hdzu' ? text(box.closest('.topic-title').find('.small').text()) : '';
    items.push({ title, url, note: note.slice(0, 150) });
  });
  if (!items.length) {
    if (site === 'yinfans' && /jump-node|本站已正式关停/.test(html)) throw new HDResourceUnavailableError(YINFANS_CLOSED, 410);
    if (/Loading\.\.\./.test(html)) throw new Error('源站当前返回跳转页，未读取到影片目录');
    if (/网站维护中/.test(html)) throw new Error('源站正在维护，暂时无法读取目录');
    throw new Error(site === 'hdzu' ? '暂未取得可验证的影片目录' : '未读取到影片目录，源站可能限制访问或已更改页面');
  }
  let next: string | undefined;
  $('a[href]').each((_, el) => {
    if (next) return;
    const a = $(el);
    if (a.attr('rel') !== 'next' && !/^(下一页|下页|Next|›|»|▶)$/i.test(text(a.text()))) return;
    const raw = a.attr('href');
    const candidate = raw && resourcePageUrl(site, absoluteUrl(raw, pageUrl), false);
    if (candidate && candidate !== pageUrl) next = candidate;
  });
  // The source uses a load-more button; its public GET ?page=N returns the same next batch.
  if (site === 'hdzu' && $('#getmore').length && items.length === 20) {
    const candidate = new URL(pageUrl);
    candidate.searchParams.set('page', String(Number(candidate.searchParams.get('page') || 1) + 1));
    next = resourcePageUrl(site, candidate.href, false) || undefined;
  }
  return { items, next, fetchedAt: new Date().toISOString() };
}

export function downloadResource(raw: string, base: string): Pick<HDResourceLink, 'url' | 'kind'> | null {
  try {
    const url = new URL(raw, base);
    if (url.href.length > 4096 || url.username || url.password) return null;
    if (url.protocol === 'magnet:' && /^urn:btih:(?:[a-f0-9]{40}|[a-z2-7]{32})$/i.test(url.searchParams.get('xt') || '')) return { url: url.href, kind: '磁力' };
    if (url.protocol !== 'https:' || url.port || /^(localhost|.*\.local)$/.test(url.hostname) || /^\[|^\d+(?:\.\d+){0,3}$/.test(url.hostname)) return null;
    if (['pan.baidu.com', 'pan.quark.cn', 'www.alipan.com', 'www.aliyundrive.com', '115.com', '115cdn.com', 'drive.uc.cn'].includes(url.hostname)) return { url: url.href, kind: '网盘' };
    if (/\.torrent$/i.test(url.pathname)) return { url: url.href, kind: '种子' };
    if (/\.(?:mp4|mkv|m3u8|iso)$/i.test(url.pathname)) return { url: url.href, kind: '文件' };
  } catch { /* malformed or non-download link */ }
  return null;
}

export function parseResourceDetail(site: HDResourceSiteId, html: string, url: string): HDResourceDetail {
  const $ = load(html);
  const root = $(site === 'rrdynb' ? '.movie-txt' : site === '1lou' ? '.message' : site === 'hdzu' ? '.sidebar-left .topic > .panel-body' : '.entry-content').first();
  root.find('script, style, iframe, form, button').remove();
  const heading = $('h1').first().clone();
  heading.find('small').prepend(' ');
  const title = text(heading.text());
  if (!title || !root.length) throw new Error('未读取到影片详情，源站可能限制访问或已更改页面');
  const content = text((site === 'hdzu' ? root.find('.topic-content') : root).text());
  const loginRequired = /需要.*(?:注册会员|登录)|登录后.*(?:查看|下载)|权限不足|游客或没权限会员/.test(text(root.text()));
  const resources: HDResourceLink[] = [], seen = new Set<string>();
  (site === 'hdzu' ? root.find('.movie-url a[href]') : root.find('a[href]')).each((_, el) => {
    const a = $(el), resource = downloadResource(a.attr('href') || '', url);
    if (!resource || seen.has(resource.url) || resources.length >= 100 || loginRequired) return;
    seen.add(resource.url);
    const row = a.closest('tr');
    const label = text((row.length ? row.children('td').map((_, cell) => $(cell).text()).get().join(' ') : a.parent('p').text() || a.text())).slice(0, 500);
    resources.push({ ...resource, title: label || `${resource.kind}资源` });
  });
  return { title: title.slice(0, 250), url, summary: content.slice(0, 1800), resources, loginRequired, fetchedAt: new Date().toISOString() };
}

async function readPage(site: HDResourceSiteId, start: string, detail: boolean, signal?: AbortSignal) {
  const deadline = AbortSignal.any([AbortSignal.timeout(16000), ...(signal ? [signal] : [])]);
  let url = start;
  for (let hop = 0; hop < 4; hop++) {
    if (!resourcePageUrl(site, url, detail)) throw new Error('源站跳转离开了影片目录，暂时无法读取');
    const verdict = await checkUpstreamAllowed(url);
    if (!verdict.ok) throw new Error('源站地址不可访问');
    const response = await fetch(url, { signal: deadline, redirect: 'manual', headers: { 'User-Agent': UA }, cache: 'no-store' });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const target = new URL(response.headers.get('location') || '/', url).href;
      if (site === 'yinfans' && detail && resourcePageUrl(site, target, false) && new URL(target).pathname === '/') {
        throw new HDResourceUnavailableError(YINFANS_CLOSED, 410);
      }
      url = target;
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`源站暂时无法访问（HTTP ${response.status}）`); }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('源站返回空页面');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 2_000_000) throw new Error('源站页面过大，暂时无法读取');
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    return { html: Buffer.concat(chunks).toString('utf8'), url };
  }
  throw new Error('源站跳转次数过多');
}
export async function getResourcePage(site: HDResourceSiteId, raw: string, detail: boolean, signal?: AbortSignal) {
  const url = resourcePageUrl(site, raw, detail);
  if (!url) throw new Error('无效的影片目录地址');
  const key = `hd-resource:${site}:${detail}:${url}`;
  const cached = getCache<HDResourceCatalog | HDResourceDetail>(key);
  if (cached) return cached;
  try {
    const page = await readPage(site, url, detail, signal);
    const result = detail ? parseResourceDetail(site, page.html, page.url) : parseResourceCatalog(site, page.html, page.url);
    setCache(key, result, 10 * 60_000);
    return result;
  } catch (error) {
    throw resourceConnectionError(site, error);
  }
}

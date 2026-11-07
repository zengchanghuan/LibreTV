import type { SearchResultItem, VideoDetail } from './types';

/**
 * Apple CMS（苹果CMS）资源站响应解析
 * 与旧版 js/api.js 逻辑对齐，迁移为纯函数以便单元测试。
 */

const M3U8_PATTERN = /\$https?:\/\/[^"'\s]+?\.m3u8/g;

const UA_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept: 'application/json',
};

export function cmsRequestHeaders(): Record<string, string> {
  return { ...UA_HEADERS };
}

/** 搜索响应 → 统一结果列表 */
export function parseSearchList(
  data: unknown,
  source: { key: string; name: string; url: string; isAdult?: boolean }
): SearchResultItem[] {
  if (!data || typeof data !== 'object') throw new Error('API返回的数据格式无效');
  const list = (data as { list?: unknown }).list;
  // 部分源站无结果时返回 list: null（而非 []），视为空结果而非格式错误
  if (list !== null && list !== undefined && !Array.isArray(list)) {
    throw new Error('API返回的数据格式无效');
  }
  return (Array.isArray(list) ? list : []).map((item) => {
    const vod = item as Record<string, unknown>;
    return {
      sourceKey: source.key,
      sourceName: source.name,
      vodId: String(vod.vod_id ?? ''),
      name: String(vod.vod_name ?? ''),
      pic: typeof vod.vod_pic === 'string' ? vod.vod_pic : undefined,
      typeName: typeof vod.type_name === 'string' ? vod.type_name : undefined,
      year: yearString(vod.vod_year),
      area: typeof vod.vod_area === 'string' ? vod.vod_area : undefined,
      remarks: typeof vod.vod_remarks === 'string' ? vod.vod_remarks : undefined,
      sourceUrl: source.url,
      isAdult: source.isAdult,
    };
  });
}

/**
 * 从 vod_play_url 中提取分集地址：格式 源1$$$源2，集1$URL1#集2$URL2。
 * 部分源（如量子 lziapi、非凡 ffzy）第一条线路是网页中转页（…/share/xxx，不可播），
 * 真实 m3u8 在后面的线路里，因此优先取包含 m3u8 直链的线路；均无 m3u8 时回退第一条。
 */
export function extractEpisodesFromPlayUrl(playUrl: string): string[] {
  if (!playUrl) return [];
  const groups = playUrl
    .split('$$$')
    .map((group) =>
      group
        .split('#')
        .map((ep) => {
          const parts = ep.split('$');
          return parts.length > 1 ? parts[1] : '';
        })
        .filter((url) => url.startsWith('http://') || url.startsWith('https://'))
    )
    .filter((eps) => eps.length > 0);
  if (groups.length === 0) return [];
  return groups.find((eps) => eps.some((url) => url.includes('.m3u8'))) ?? groups[0];
}

/** 从简介文本中兜底提取 m3u8 链接 */
export function extractM3u8FromText(text: string): string[] {
  if (!text) return [];
  const matches = text.match(M3U8_PATTERN) || [];
  return matches.map((link) => link.replace(/^\$/, ''));
}

/** 详情 JSON 响应 → 统一详情 */
export function parseDetail(
  data: unknown,
  source: { key: string; name: string; url: string }
): VideoDetail {
  const d = data as { list?: Record<string, unknown>[] };
  if (!d || !Array.isArray(d.list) || d.list.length === 0) {
    throw new Error('获取到的详情内容无效');
  }
  const vod = d.list[0];
  let episodes = extractEpisodesFromPlayUrl(String(vod.vod_play_url ?? ''));
  if (episodes.length === 0) {
    episodes = extractM3u8FromText(String(vod.vod_content ?? ''));
  }
  return {
    episodes,
    videoInfo: {
      title: str(vod.vod_name),
      cover: str(vod.vod_pic),
      desc: str(vod.vod_content),
      typeName: str(vod.type_name),
      year: yearString(vod.vod_year),
      area: str(vod.vod_area),
      director: str(vod.vod_director),
      actor: str(vod.vod_actor),
      remarks: str(vod.vod_remarks),
      sourceKey: source.key,
      sourceName: source.name,
      sourceUrl: source.url,
    },
  };
}

function str(v: unknown): string | undefined {
  const s = typeof v === 'string' ? v.trim() : '';
  return s || undefined;
}

function yearString(value: unknown): string | undefined {
  if (typeof value === 'number') return /^(18|19|20)\d{2}$/.test(String(value)) ? String(value) : undefined;
  return str(value);
}

/**
 * 部分源的列表接口不返回播放地址，需要爬详情页 HTML 提取 m3u8。
 * 与旧版 handleSpecialSourceDetail 对齐。
 */
export function parseDetailPageHtml(
  html: string,
  source: { key: string; name: string; url: string }
): VideoDetail {
  // 先尝试通用模式，再尝试非凡影视的日期哈希特征路径
  let matches = html.match(/\$(https?:\/\/[^"'\s]+?\.m3u8)/g) || [];
  if (matches.length === 0) {
    matches = html.match(/\$(https?:\/\/[^"'\s]+?\/\d{8}\/\d+_[a-f0-9]+\/index\.m3u8)/g) || [];
  }
  // 去重并清理尾缀
  const episodes = [...new Set(matches)].map((link) => {
    let u = link.substring(1);
    const parenIndex = u.indexOf('(');
    if (parenIndex > 0) u = u.substring(0, parenIndex);
    return u;
  });

  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
  const descMatch = html.match(/<div[^>]*class=["']sketch["'][^>]*>([\s\S]*?)<\/div>/);

  return {
    episodes,
    videoInfo: {
      title: titleMatch ? titleMatch[1].trim() : undefined,
      desc: descMatch ? descMatch[1].replace(/<[^>]+>/g, ' ').trim() : undefined,
      sourceKey: source.key,
      sourceName: source.name,
      sourceUrl: source.url,
    },
  };
}

/** 敏感分类过滤（成人内容过滤，关键词与旧版保持一致） */
const ADULT_KEYWORDS = [
  '伦理片', '福利', '倫理片', '福利片', '日本伦理', '日本福利', '日本福利片', '日本伦理片', '擦边短剧', '擦边', '韩国伦理','里番动漫', '门事件', '萝莉少女', '制服诱惑', '国产传媒',
  'cosplay', '黑丝诱惑', '无码', '日本无码', '有码', '日本有码', 'SWAG',
  '网红主播', '色情片', '同性片', '福利视频', '无码高清', '有码高清', '91视频', '自拍偷拍', 'mini传媒', '福利片',
];

export function isAdultContent(typeName: string | undefined): boolean {
  if (!typeName) return false;
  return ADULT_KEYWORDS.some((k) => typeName.includes(k));
}

export function filterAdultResults<T extends { typeName?: string }>(items: T[], enabled: boolean): T[] {
  if (!enabled) return items;
  return items.filter((item) => !isAdultContent(item.typeName));
}

/**
 * 归一化标题/关键词：去空白、标点与符号，转小写。
 * 用于跨标点差异匹配（源站存「摔跤吧!爸爸」而用户搜「摔跤吧！爸爸」）。
 */
export function normalizeTitle(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function seriesNumber(value: string): number {
  if (/^\d+$/.test(value)) return Number(value);
  const digits = '零一二三四五六七八九';
  value = value.replace(/两/g, '二').replace(/〇/g, '零');
  if (/^[一二三四五六七八九]?十[一二三四五六七八九]?$/.test(value)) {
    const [tens, units] = value.split('十');
    return (tens ? digits.indexOf(tens) : 1) * 10 + (units ? digits.indexOf(units) : 0);
  }
  return value.length === 1 ? digits.indexOf(value) : NaN;
}

/** Interpret season/sequel suffixes without treating years or numeric titles as seasons. */
function seriesTitle(title: string) {
  const value = title.normalize('NFKC').trim();
  const match = value.match(/^(.*?)(?:第\s*([\d零〇一二两三四五六七八九十]{1,3})\s*([季部])|\b(?:season\s*|s)(\d{1,2})(?!\d)|(\d{1,2})(?!\d))(.*)$/i);
  if (!match) return undefined;
  const [, rawBase, chinese, unit, english, numeric, suffix] = match;
  const base = rawBase.replace(/[\s:：\-–—]+$/, '').trim();
  if (normalizeTitle(base).length < 2 || (numeric && (/\d$/.test(base) || (suffix && !/^[\s:：[(（【]/.test(suffix))))) return undefined;
  const number = seriesNumber(chinese || english || numeric);
  if (!Number.isInteger(number) || number < 1 || number > 99) return undefined;
  return { base, number, kind: unit === '部' ? 'part' : chinese || english ? 'season' : 'number', suffix };
}

/** Ask sources for the series title once, then enforce the requested season locally. */
export function searchUpstreamTerm(query: string): string {
  const series = seriesTitle(query);
  return series && !normalizeTitle(series.suffix) ? series.base : query;
}

/** Same-season spelling variants share a card; edition/commentary suffixes remain distinct. */
export function searchTitleKey(title: string): string {
  const series = seriesTitle(title);
  return series ? `${normalizeTitle(series.base)}#${series.number}#${normalizeTitle(series.suffix)}` : normalizeTitle(title);
}

/**
 * 相关性判断：结果标题是否真的命中了搜索词。
 * 部分采集站会做分词/OR 模糊搜索（搜「摔跤吧！爸爸」返回一堆「爸爸XXX」），
 * 逐条校验后只保留真正相关的结果。
 *
 * 带季/部编号时要求系列名和编号一致，兼容中文数字、阿拉伯数字及 S02；
 * 普通查询要求归一化后的标题包含完整关键词；
 * 多词查询（空格分隔）时放宽为「每个词都命中」即可（如「钢铁侠 2008」）。
 */
export function isRelevant(name: string, wd: string): boolean {
  const nName = normalizeTitle(name);
  const nWd = normalizeTitle(wd);
  if (!nWd) return true;
  if (!nName) return false;
  const query = seriesTitle(wd);
  if (query) {
    const candidate = seriesTitle(name);
    return !!candidate && normalizeTitle(candidate.base) === normalizeTitle(query.base)
      && candidate.number === query.number
      && normalizeTitle(candidate.suffix).includes(normalizeTitle(query.suffix))
      && (candidate.kind === 'number' || query.kind === 'number' || candidate.kind === query.kind);
  }
  if (nName.includes(nWd)) return true;
  const tokens = wd.trim().split(/\s+/);
  if (tokens.length > 1) {
    return tokens.every((t) => {
      const n = normalizeTitle(t);
      return n && nName.includes(n);
    });
  }
  return false;
}

/**
 * 结果相关性过滤：丢弃与关键词无关的条目。
 * 无匹配时返回空列表，不能把源站热门推荐或分词噪声当作搜索结果。
 */
export function filterRelevantResults<T extends { name?: string }>(items: T[], wd: string): T[] {
  return items.filter((item) => isRelevant(item.name || '', wd));
}

/** Shared by incremental browser results and the final server response. */
export function prepareSearchResults(items: SearchResultItem[], wd: string, filterAdult = true): SearchResultItem[] {
  const seen = new Set<string>();
  const list = filterRelevantResults(filterAdultResults(items, filterAdult), wd).filter(item => {
    const key = JSON.stringify([item.sourceKey, item.vodId]);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  const exact = searchTitleKey(wd);
  const derivative = /解说|解說|预告|預告|花絮|幕后|幕後/;
  const score = (item: SearchResultItem) => {
    const title = searchTitleKey(item.name);
    const relevance = title === exact ? 0 : title.startsWith(exact) ? 1 : 2;
    return relevance + (!derivative.test(wd) && derivative.test(item.name + (item.typeName || '')) ? 10 : 0);
  };
  return list.sort((a, b) => score(a) - score(b)
    || a.name.localeCompare(b.name, 'zh-Hans-CN')
    || a.sourceName.localeCompare(b.sourceName, 'zh-Hans-CN'));
}

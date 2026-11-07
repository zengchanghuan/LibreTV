import { isAdultContent, normalizeTitle, parseSearchList } from './cms-parser';
import type { RelatedVideo, SearchResultItem, SourceConfig } from './types';
import { contentGenres, genreSimilarity, personTokens as tokens } from './content-similarity';

export interface RelatedCandidate extends SearchResultItem {
  typeId?: string;
  genres?: string;
  director?: string;
  actor?: string;
}

const text = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';

/** Keep list metadata without fetching a separate detail for every candidate. */
export function parseRelatedCandidates(data: unknown, source: SourceConfig): RelatedCandidate[] {
  const items = parseSearchList(data, source);
  const raw = (data as { list?: Record<string, unknown>[] }).list ?? [];
  return items.slice(0, 200).map((item, index) => ({
    ...item,
    year: text(raw[index].vod_year),
    typeId: text(raw[index].type_id),
    genres: text(raw[index].vod_class),
    director: text(raw[index].vod_director),
    actor: text(raw[index].vod_actor),
  }));
}

/** Strip resource/version labels, but retain sequel numbers and release years. */
export function relatedTitle(title: string): string {
  return normalizeTitle(title.replace(
    /(?:\s*[（(\[【]?(?:国语|粤语|普通话|英语|日语|韩语|中字|中文|中英双字|双语|原声|高清|蓝光|超清|修复|加长|未删减|4k|1080p|720p)(?:版)?[）)\]】]?)+\s*$/gi,
    '',
  ));
}

/** Conservative series query: punctuation subtitle or a trailing sequel/season number. */
export function seriesQuery(title: string): string | undefined {
  const cleaned = title.replace(/[（(\[【].*?[）)\]】]/g, '').trim();
  const stem = cleaned.split(/[:：]/)[0]
    .replace(/(?:第[一二三四五六七八九十百\d]+[季部集]|[\s·-]*\d+|\s+[IVX]+)$/i, '').trim();
  return normalizeTitle(stem).length >= 3 && stem.length <= 40 ? stem : undefined;
}

function genres(item: RelatedCandidate): string[] {
  return contentGenres(`${item.genres || ''},${item.typeName || ''}`);
}

function medium(item: RelatedCandidate): string {
  const category = item.typeName || '';
  if (/解说|预告|花絮/.test(category + item.name)) return 'extra';
  if (/动漫|动画/.test(category)) return 'animation';
  if (/综艺/.test(category)) return 'show';
  if (/短剧/.test(category)) return 'short';
  if (/电视剧|剧集|连续剧|国产剧|欧美剧|韩剧|日剧|港剧|台剧|泰剧|海外剧/.test(category)) return 'tv';
  if (/电影|片/.test(category)) return 'movie';
  return '';
}

function common(left: string[], right: string[]): string[] {
  return left.filter((value) => right.includes(value));
}

/** Content-based ranking. Region/year only break ties; neither can create a recommendation. */
export function rankRelatedVideos(
  seed: RelatedCandidate,
  candidates: RelatedCandidate[],
  filterAdult = true,
): RelatedVideo[] {
  const seedTitle = relatedTitle(seed.name);
  const seedSeries = seriesQuery(seed.name);
  const seedMedium = medium(seed);
  const ranked: RelatedVideo[] = [];
  for (const item of candidates) {
    const title = relatedTitle(item.name);
    if (!title || !/^[\w-]+$/.test(item.vodId) || item.vodId === seed.vodId || title === seedTitle) continue;
    if (filterAdult && (item.isAdult || isAdultContent(`${item.typeName || ''},${item.genres || ''}`))) continue;
    const itemMedium = medium(item);
    if (itemMedium === 'extra' || (seedMedium && itemMedium && seedMedium !== itemMedium)) continue;

    let score = 0;
    const reasons: string[] = [];
    const itemSeries = seriesQuery(item.name);
    if (seedSeries && itemSeries && relatedTitle(seedSeries) === relatedTitle(itemSeries)) {
      score += 60;
      reasons.push('相近系列片名');
    }
    const directors = common(tokens(seed.director), tokens(item.director));
    if (directors.length) {
      score += 40;
      reasons.push(`同导演 · ${directors[0]}`);
    }
    const actors = common(tokens(seed.actor), tokens(item.actor));
    if (actors.length) {
      score += Math.min(30, actors.length * 15);
      reasons.push(`共同主演 · ${actors[0]}`);
    }
    const similarity = genreSimilarity(genres(seed), genres(item));
    const series = reasons.includes('相近系列片名');
    if (!series && !directors.length && !(actors.length && (similarity.specific.length || actors.length >= 2)) && similarity.specific.length < 2) continue;
    if (similarity.specific.length) {
      score += similarity.score;
      reasons.push(`相近题材 · ${similarity.specific.slice(0, 2).join(' / ')}`);
    }
    if (!reasons.length) continue;
    if (common(tokens(seed.area), tokens(item.area)).length) score += 5;
    const seedYear = Number(seed.year);
    const year = Number(item.year);
    if (seedYear >= 1888 && year >= 1888) score += Math.max(0, 5 - Math.abs(seedYear - year));
    ranked.push({ ...item, score, reasons: reasons.slice(0, 2) });
  }
  ranked.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'zh-Hans-CN') || a.vodId.localeCompare(b.vodId));
  const seen = new Set<string>();
  return ranked.filter((item) => {
    // Preserve remakes from different years while merging language/resource versions.
    const key = `${relatedTitle(item.name)}:${item.year || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 12);
}

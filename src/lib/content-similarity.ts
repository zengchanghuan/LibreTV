import { normalizeTitle } from './cms-parser';

export function personTokens(value?: string): string[] {
  return [...new Set((value || '').replace(/\bN\/A\b/gi, '').split(/[,，、/|;；\n]+/).map(s => s.trim())
    .filter(s => s && !/^(未知|不详|暂无|无|其他|其它|null|none|n\/a|unknown|待定|[-—]+)$/i.test(s)))];
}
const CATEGORIES = /^(?:电影|电视|电视剧|剧集|视频|韩剧|韩国剧|日剧|日本剧|美剧|英剧|港剧|香港剧|台剧|台湾剧|泰剧|泰国剧|国产剧|大陆剧|内地剧|欧美剧|海外剧|连续剧|movie|film|tv|series)$/i;
export function contentGenres(value?: string) {
  return [...new Set(personTokens(value).filter(s => !CATEGORIES.test(s)).map(s => s.replace(/电影|片$/g, '')).filter(Boolean))];
}
export function sharedValues(a: string[], b: string[]) {
  return a.filter(v => b.some(w => normalizeTitle(v) === normalizeTitle(w)));
}
const GENERIC = new Set(['剧情', '喜剧', '爱情']);
export function genreSimilarity(a: string[], b: string[]) {
  const shared = sharedValues(a, b), specific = shared.filter(g => !GENERIC.has(g));
  const weight = (g: string) => GENERIC.has(g) ? 1 : 4;
  const score = Math.round(20 * shared.reduce((n, g) => n + weight(g), 0)
    / Math.max(1, [...new Set([...a, ...b])].reduce((n, g) => n + weight(g), 0)));
  return { shared, specific, score };
}

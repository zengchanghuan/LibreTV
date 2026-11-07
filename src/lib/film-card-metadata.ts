import type { FilmPosterMetadata } from './film-poster-metadata';
import type { RecommendedWork, ResourceMatch } from './recommendations';

export function availableFilmText(value?: string) {
  const text = value?.trim();
  return text && !/^(?:未知|不详|暂无|无|其他|其它|null|undefined|unknown|n\/a|[-—]+)$/i.test(text) ? text : undefined;
}

/** Prefer curated values; empty upstream fields must never erase known information. */
export function mergeFilmMetadata(...sources: (FilmPosterMetadata | undefined)[]): FilmPosterMetadata {
  const result: FilmPosterMetadata = {};
  for (const source of sources) {
    if (!source) continue;
    for (const key of Object.keys(source) as (keyof FilmPosterMetadata)[]) {
      const value = availableFilmText(source[key]);
      if (!availableFilmText(result[key]) && value) Object.assign(result, { [key]: value });
    }
  }
  return result;
}

export function filmRatingUrl(metadata: FilmPosterMetadata) {
  const source = metadata.ratingSource || '豆瓣';
  if (source === '豆瓣') {
    if (/^\d+$/.test(metadata.doubanId || '')) return `https://movie.douban.com/subject/${metadata.doubanId}/`;
    if (/^https:\/\/movie\.douban\.com\/subject\/\d+\/?$/.test(metadata.source || '')) return metadata.source;
  }
  if (source === 'IMDb' && /^https:\/\/www\.imdb\.com\/title\/tt\d+\/?$/.test(metadata.source || '')) return metadata.source;
}

export function filmPosterUrl(value?: string, base?: string) {
  if (!value?.trim()) return undefined;
  if (!base && /^\/(?!\/)/.test(value)) return value;
  try {
    const url = new URL(value, base);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

export function recommendationCardInfo(work: RecommendedWork, resources: ResourceMatch[] = []) {
  const metadata = mergeFilmMetadata(work.metadata, {
    poster: work.poster, genre: work.genres.join(' / '), director: work.directors.join(' / '), cast: work.cast.join('、'),
  }, ...resources.map(item => item.metadata));
  const posters = [...new Set([metadata.poster, work.poster,
    ...resources.flatMap(item => [filmPosterUrl(item.metadata?.poster, item.sourceUrl), filmPosterUrl(item.pic, item.sourceUrl)]),
  ].map(url => filmPosterUrl(url)).filter((url): url is string => Boolean(url)))].slice(0, 6);
  return { metadata, posters, sourceCount: new Set(resources.map(item => item.sourceUrl || item.sourceKey)).size };
}

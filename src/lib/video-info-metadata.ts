import { availableFilmText, filmRatingUrl } from './film-card-metadata';
import { classifyMediaType } from './media-type';
import { resultYear, splitSearchTitle } from './search-result-identity';
import { isDerivativeTitle, workCatalog, workTitleKey, type CatalogWork } from './work-catalog';
import type { VideoInfo } from './types';

function people(value?: string) {
  return (availableFilmText(value) || '').split(/[,，、/;；|\n]+/).map(name => name.trim().normalize('NFKC')).filter(Boolean);
}

/** Match source evidence, never an unverified rating or a title without a year. */
export function matchVideoWork(info: VideoInfo): CatalogWork | undefined {
  const title = splitSearchTitle(info.title || '');
  const year = resultYear(info.year) || title.year;
  if (!year || (title.year && title.year !== year) || isDerivativeTitle((info.title || '') + (info.typeName || ''))) return;
  const kind = classifyMediaType(info.typeName);
  const candidates = workCatalog.findByTitle(title.title).filter(work => work.year === year
    && (kind === 'unknown' || work.mediaType === 'unknown' || work.mediaType === kind));
  if (candidates.length !== 1) return;
  const work = candidates[0];
  const directors = people(info.director), knownDirectors = people(work.metadata.director);
  const cast = people(info.actor), knownCast = people(work.metadata.cast);
  const directorMatch = directors.some(name => knownDirectors.includes(name));
  const castMatches = cast.filter(name => knownCast.includes(name)).length;
  if (directors.length && knownDirectors.length && !directorMatch) return;
  if (cast.length && knownCast.length && !castMatches) return;
  if (kind === 'unknown' && !directorMatch && castMatches < 2) return;
  return work;
}

/** Local enrichment adds no network request or delay to starting playback. */
export function enrichVideoInfo(info: VideoInfo): VideoInfo {
  const work = matchVideoWork(info);
  if (!work) return info;
  const meta = work.metadata;
  const rawRating = meta.rating?.trim();
  const score = rawRating && /^\d{1,2}(?:\.\d+)?$/.test(rawRating) ? Number(rawRating) : NaN;
  const source = availableFilmText(meta.ratingSource) || '豆瓣';
  const rating = score > 0 && score <= 10
    ? { value: score.toFixed(1), source, url: filmRatingUrl(meta) } : undefined;
  const excluded = new Set([work.title, info.title || '', work.originalTitle || ''].map(workTitleKey));
  const aliases = [...new Set(work.aliases)].filter(name => !excluded.has(workTitleKey(name))
    && !new RegExp(`[（(]${work.year}[）)]$`).test(name));
  return { ...info, rating, originalTitle: work.originalTitle, aliases,
    genre: availableFilmText(meta.genre),
    area: availableFilmText(info.area) || meta.area,
    director: availableFilmText(info.director) || meta.director,
    actor: availableFilmText(info.actor) || meta.cast,
    desc: availableFilmText(info.desc) || meta.intro,
  };
}

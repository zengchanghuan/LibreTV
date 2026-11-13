import { sourceContentIssue } from './source-content-corrections';
import { classifyMediaType, type MediaType } from './media-type';
import { workCatalog, workTitleKey, isDerivativeTitle, type CatalogWork } from './work-catalog';
import type { SearchResultItem } from './types';

export function resultYear(year?: string) {
  return year?.match(/\b(?:18|19|20)\d{2}\b/)?.[0];
}

/** A joined year needs a matching catalog title/year; numeric titles and sequels stay intact. */
export function splitSearchTitle(title: string) {
  const value = title.normalize('NFKC').trim();
  // A catalogued literal title takes precedence over a possible year suffix.
  if (workCatalog.findByTitle(value).length) return { title: value, year: undefined };
  const match = value.match(/^(.*?)(?:\s+((?:18|19|20)\d{2})|\s*[（(\[【]((?:18|19|20)\d{2})[）)\]】])$/);
  if (match?.[1].trim()) return { title: match[1].trim(), year: match[2] || match[3] };
  const joined = value.match(/^(.+?)((?:18|19|20)\d{2})$/);
  if (joined && workCatalog.findByTitle(joined[1]).some(work => work.year === joined[2])) {
    return { title: joined[1], year: joined[2] };
  }
  return { title: value, year: undefined };
}

export interface SearchIdentity {
  title: string;
  year?: string;
  mediaType: MediaType;
  work?: CatalogWork;
  reason?: string;
}

function people(value?: string) {
  return new Set((value || '').split(/[,，、/;；|\n]+/).map(s => s.trim()).filter(Boolean));
}

function corroborates(work: CatalogWork, details: SearchResultItem['identityDetails']) {
  if (!details) return false;
  const actors = people(details.actor), directors = people(details.director);
  const castMatches = [...people(work.metadata.cast)].filter(name => actors.has(name)).length;
  const directorMatches = [...people(work.metadata.director)].some(name => directors.has(name));
  // A shared actor or poster alone is not sufficient, including for remakes and sequels.
  return directorMatches && castMatches >= 2;
}

/** Recomputed from source evidence, never from a previously assigned workId. */
export function searchResultIdentity(item: SearchResultItem): SearchIdentity {
  const issue = sourceContentIssue(item.sourceUrl, item.vodId);
  if (issue) return { title: item.name, mediaType: 'unknown', reason: issue.message };
  const details = item.identityDetails;
  const rawTitle = details?.title || item.name;
  const title = splitSearchTitle(rawTitle);
  const year = resultYear(details?.year || item.year);
  const mediaType = classifyMediaType(details?.typeName || item.typeName);
  const base: SearchIdentity = { title: title.title, year: year || title.year, mediaType };
  const originalTitle = splitSearchTitle(item.name);
  if (details?.title && workTitleKey(originalTitle.title) !== workTitleKey(title.title)) {
    const originalWorks = workCatalog.findByTitle(originalTitle.title);
    if (!originalWorks.some(work => workCatalog.findByTitle(title.title).includes(work))) {
      return { title: item.name, year: resultYear(item.year), mediaType: classifyMediaType(item.typeName), reason: '详情名称与搜索结果不一致' };
    }
  }
  const derivative = isDerivativeTitle(item.name + rawTitle + (item.typeName || '') + (details?.typeName || ''));
  const candidates = derivative ? [] : workCatalog.findByTitle(title.title);
  const staffMatches = candidates.filter(work => work.mediaType !== 'unknown' && corroborates(work, details));
  const confirmed = (work: CatalogWork): SearchIdentity => ({ title: work.title, year: work.year, mediaType: work.mediaType, work });
  if (staffMatches.length === 1) return confirmed(staffMatches[0]);

  if (title.year && year && title.year !== year) return { ...base, reason: '标题年份与片源资料不一致' };
  if (!base.year || mediaType === 'unknown') return { ...base, reason: '年份或类型待确认' };
  const exact = candidates.filter(work => work.year === base.year && work.mediaType === mediaType);
  if (exact.length === 1) return confirmed(exact[0]);
  if (exact.length > 1) return { ...base, reason: '存在多个同名作品，归属待确认' };
  if (candidates.some(work => work.mediaType === mediaType)) {
    return { ...base, reason: '年份与已收录的同名作品不同，待核对' };
  }
  // A known movie must not swallow an otherwise complete same-name TV result.
  return base;
}

export function searchIdentityTitleKey(title: string) {
  return workTitleKey(splitSearchTitle(title).title);
}

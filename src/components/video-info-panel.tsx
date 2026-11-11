'use client';

import { useEffect, useId, useState } from 'react';
import type { VideoInfo } from '@/lib/types';
import { availableFilmText } from '@/lib/film-card-metadata';
import { Icon } from './icon';

export function videoInfoSummary(info?: VideoInfo): string {
  return [info?.year, info?.area, info?.genre || info?.typeName].map(availableFilmText).filter(Boolean).join(' · ');
}

export function VideoInfoPanel({ info, compactOnMobile = false }: { info?: VideoInfo; compactOnMobile?: boolean }) {
  const id = useId();
  const [description, setDescription] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [castExpanded, setCastExpanded] = useState(false);

  useEffect(() => {
    // Parse into an inert template; never render source HTML in the live page.
    const template = document.createElement('template');
    template.innerHTML = info?.desc || '';
    template.content.querySelectorAll('script, style, noscript, iframe').forEach(element => element.remove());
    template.content.querySelectorAll('br').forEach(element => element.replaceWith('\n'));
    template.content.querySelectorAll('p, div, li').forEach(element => element.append('\n'));
    setDescription(availableFilmText(template.content.textContent?.replace(/[^\S\n]+/g, ' ').replace(/\n\s*\n/g, '\n\n')) || '');
    setExpanded(false);
    setCastExpanded(false);
  }, [info?.desc, info?.title, info?.year]);

  if (!info) return null;
  const cast = (availableFilmText(info.actor) || '').split(/[,，、/;；|\n]+/).map(name => name.trim()).filter(Boolean);
  const moreRows = [
    ['原名', info.originalTitle],
    ['又名', info.aliases?.join(' / ')],
    ['片长', info.duration],
    ['语言', info.language],
    ['上映', info.releaseDate],
  ].map(([label, value]) => [label, availableFilmText(value)] as const).filter(([, value]) => value);
  const rating = info.rating;
  const ratingUrl = rating?.url && /^https:\/\//.test(rating.url) ? rating.url : undefined;
  const summary = videoInfoSummary(info);
  const director = availableFilmText(info.director);

  return <section className={compactOnMobile ? 'mt-4 sm:border-t sm:border-line sm:pt-4' : 'mt-4 border-t border-line pt-4'} aria-labelledby={`${id}-heading`}>
    <h2 id={`${id}-heading`} className="text-base font-semibold text-content mb-4">影片资料</h2>
    {rating ? <div className="flex items-center gap-5 mb-4" aria-label={`${rating.source}评分 ${rating.value}，满分10分`}>
      <div className="flex items-baseline gap-1.5 text-rating"><span aria-hidden="true" className="self-center text-lg">★</span><strong className="text-3xl font-semibold tabular-nums">{rating.value}</strong><span className="text-xs text-muted">/ 10</span></div>
      <div className="text-xs leading-relaxed"><p className="text-content">{rating.source}评分</p>{ratingUrl && <a href={ratingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 min-h-8 text-accent hover:underline">查看来源<Icon name="link" className="w-3 h-3" /></a>}</div>
    </div> : <p className="mb-4 text-sm text-muted">暂无评分</p>}
    {summary && <p className="mb-4 text-sm leading-relaxed text-muted [overflow-wrap:anywhere]">{summary}</p>}
    <dl className="space-y-3 text-sm leading-relaxed">
      {director && <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-3"><dt className="text-muted">导演</dt><dd className="text-content [overflow-wrap:anywhere]">{director}</dd></div>}
      {cast.length > 0 && <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-3"><dt className="text-muted">主演</dt><dd className="text-content [overflow-wrap:anywhere]"><span id={`${id}-cast`}>{(castExpanded ? cast : cast.slice(0, 3)).join(' · ')}</span>{cast.length > 3 && <button type="button" className="ml-2 min-h-11 text-xs text-accent hover:underline" aria-expanded={castExpanded} aria-controls={`${id}-cast`} onClick={() => setCastExpanded(value => !value)}>{castExpanded ? '收起' : '全部'}</button>}</dd></div>}
    </dl>
    {moreRows.length > 0 && <details key={`${info.title}|${info.year}`} className="mt-2 group">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 text-xs text-accent [&::-webkit-details-marker]:hidden"><span className="group-open:hidden">更多资料</span><span className="hidden group-open:inline">收起资料</span><Icon name="chevronDown" className="w-3.5 h-3.5 group-open:rotate-180" /></summary>
      <dl className="space-y-3 pb-3 text-sm leading-relaxed">{moreRows.map(([label, value]) => <div key={label} className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-3"><dt className="text-muted">{label}</dt><dd className="text-content [overflow-wrap:anywhere]">{value}</dd></div>)}</dl>
    </details>}
    {description && <div className="mt-3 border-t border-line pt-4 text-sm leading-relaxed">
      <h3 className="text-content font-medium mb-2">剧情简介</h3>
      <p id={`${id}-description`} className={`text-muted whitespace-pre-line [overflow-wrap:anywhere] ${expanded ? '' : 'line-clamp-3'}`}>{description}</p>
      {description.length > 80 && <button type="button" className="inline-flex items-center gap-1 min-h-11 mt-1 text-accent hover:underline" aria-expanded={expanded} aria-controls={`${id}-description`} onClick={() => setExpanded(value => !value)}>{expanded ? '收起简介' : '展开简介'}<Icon name="chevronDown" className={`w-3.5 h-3.5 ${expanded ? 'rotate-180' : ''}`} /></button>}
    </div>}
  </section>;
}

'use client';

import { useState } from 'react';
import type { FilmPosterMetadata } from '@/lib/film-poster-metadata';
import { availableFilmText, filmRatingUrl } from '@/lib/film-card-metadata';

/** Shared factual information for collection cards and playback recommendations. */
export function FilmCardDetails({ metadata = {}, year, compact = false, spacious = false }: {
  metadata?: FilmPosterMetadata; year?: number | string; compact?: boolean; spacious?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const { rating, ratingSource = '豆瓣' } = metadata;
  const genre = availableFilmText(metadata.genre), area = availableFilmText(metadata.area);
  const cast = availableFilmText(metadata.cast), director = availableFilmText(metadata.director), intro = availableFilmText(metadata.intro);
  const ratingUrl = filmRatingUrl(metadata);
  const expandable = compact && ((cast?.length || 0) > 25 || (director?.length || 0) > 25 || (intro?.length || 0) > 65);
  return <div className={spacious ? 'space-y-3 text-sm leading-7 text-muted' : 'space-y-1 text-xs leading-relaxed text-muted'}>
    <p>{[year, genre, area].filter(Boolean).join(' · ')}</p>
    <p className={`font-medium ${rating ? 'text-rating' : 'text-muted'}`}>
      {rating ? ratingUrl ? <a href={ratingUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
        {ratingSource}评分 {rating}
      </a> : <>{ratingSource}评分 {rating}</> : '评分暂缺'}
    </p>
    {director && <p className={compact && !expanded ? 'line-clamp-2' : ''} title={director}>导演：{director}</p>}
    {cast && <p className={compact && !expanded ? 'line-clamp-2' : ''} title={cast}>主演：{cast}</p>}
    {intro && <p className={compact && !expanded ? 'line-clamp-3' : ''}>{intro}</p>}
    {expandable && <button type="button" className="text-accent hover:underline" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
      {expanded ? '收起资料' : '展开资料'}
    </button>}
  </div>;
}

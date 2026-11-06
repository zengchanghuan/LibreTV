'use client';

import Image from 'next/image';
import { useState } from 'react';
import type { MediaType } from '@/lib/media-type';
import { getFilmPosterMetadata } from '@/lib/film-poster-metadata';
import { MediaTypeLabel } from './media-type-label';

export interface PosterFilm {
  id: string;
  title: string;
  searchTitle?: string;
  year: number;
  mediaType?: MediaType;
}

export function FilmPosterGrid({ films, onPick }: { films: PosterFilm[]; onPick: (title: string) => void }) {
  return (
    <ol className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-6">
      {films.map(({ id, title, searchTitle = title, year, mediaType = 'movie' }, i) => {
        const { poster, rating, ratingSource = '豆瓣', doubanId, source, genre, cast, director, intro } = getFilmPosterMetadata(searchTitle, year) ?? {};
        // Some metadata sources credit only the poster, so do not use those as rating links.
        const ratingUrl = ratingSource === '豆瓣'
          ? doubanId ? `https://movie.douban.com/subject/${doubanId}/`
            : source?.startsWith('https://movie.douban.com/subject/') ? source : undefined
          : ratingSource === 'IMDb' && source?.startsWith('https://www.imdb.com/title/') ? source : undefined;
        return (
          <li key={id}>
            <button type="button" aria-label={`搜索《${searchTitle}》`} onClick={() => onPick(searchTitle)} className="group w-full text-left">
              <span className="relative block overflow-hidden rounded-lg bg-chip">
                <PosterImage key={poster} poster={poster} title={title} />
                <span aria-hidden="true" className="absolute top-2 left-2 rounded bg-black/80 px-2 py-1 text-xs font-bold text-white">#{i + 1}</span>
                <MediaTypeLabel type={mediaType} overlay />
              </span>
              <strong className="mt-2 block group-hover:text-accent">{title}</strong>
            </button>
            <p className="mt-1 text-xs text-muted">{year}{genre && ` · ${genre}`}</p>
            <p className={`mt-1 text-xs font-medium ${rating ? 'text-rating' : 'text-muted'}`}>
              {rating ? (
                ratingUrl ? <a href={ratingUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                  {ratingSource}评分 {rating}
                </a> : <>{ratingSource}评分 {rating}</>
              ) : '评分暂缺'}
            </p>
            {cast && <p className="my-1 text-sm">主演：{cast}</p>}
            {director && <p className="my-1 text-sm">导演：{director}</p>}
            {intro && <p className="text-xs leading-relaxed text-muted">{intro}</p>}
          </li>
        );
      })}
    </ol>
  );
}

function PosterImage({ poster, title }: { poster?: string; title: string }) {
  const [failed, setFailed] = useState(false);
  const showLogo = !poster || failed;
  return (
    <Image src={showLogo ? '/icons/icon-512.png' : poster} alt={showLogo ? 'HomeTV' : `《${title}》海报`}
      width={264} height={377} onError={() => setFailed(true)}
      className={`aspect-[7/10] w-full ${showLogo ? 'object-contain p-6' : 'object-cover'}`} />
  );
}

'use client';

import Image from 'next/image';
import { useState } from 'react';
import type { MediaType } from '@/lib/media-type';
import { getFilmPosterMetadata } from '@/lib/film-poster-metadata';
import { MediaTypeLabel } from './media-type-label';
import { FilmCardDetails } from './film-card-details';
import { resolveWork } from '@/lib/work-catalog';
import { contextForFilm, type PickFilm } from '@/lib/work-search';

export interface PosterFilm {
  id: string;
  title: string;
  searchTitle?: string;
  year: number;
  note?: string;
  mediaType?: MediaType;
}

export function FilmPosterGrid({ films, onPick }: { films: PosterFilm[]; onPick: PickFilm }) {
  return (
    <ol className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-6">
      {films.map(({ id, title, searchTitle = title, year, note, mediaType = 'movie' }, i) => {
        const metadata = getFilmPosterMetadata(searchTitle, year);
        const work = resolveWork(searchTitle, year, mediaType);
        const displayTitle = work?.title || title;
        const context = contextForFilm(searchTitle, year, mediaType);
        const poster = metadata?.poster;
        return (
          <li key={id}>
            <button type="button" aria-label={`搜索《${displayTitle}》`} onClick={() => onPick(displayTitle, context)} className="group w-full text-left">
              <span className="relative block overflow-hidden rounded-lg bg-chip">
                <PosterImage key={poster} poster={poster} title={displayTitle} />
                <span aria-hidden="true" className="absolute top-2 left-2 rounded bg-black/80 px-2 py-1 text-xs font-bold text-white">#{i + 1}</span>
                <MediaTypeLabel type={mediaType} overlay />
              </span>
              <strong className="mt-2 block group-hover:text-accent">{displayTitle}</strong>
            </button>
            {displayTitle !== title && <p className="mt-1 text-xs text-muted">榜单原名：{title}</p>}
            {note && <p className="mt-1 text-xs text-muted">{note}</p>}
            <div className="mt-1"><FilmCardDetails metadata={metadata} year={year} /></div>
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

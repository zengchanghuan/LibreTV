'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { recommendationCardInfo } from '@/lib/film-card-metadata';
import { createTaskPool } from '@/lib/task-pool';
import { workKey, type RecommendedWork } from '@/lib/recommendations';
import type { SourceConfig } from '@/lib/types';
import { MediaTypeLabel } from './media-type-label';
import { FilmPoster } from './film-poster';

const enrichCard = createTaskPool(2);

export function RecommendedWorkCard({ work, sources, filterAdult, enabled, imageMode, customProxy, onPick, hideUnknownType = false }: {
  work: RecommendedWork; sources: SourceConfig[]; filterAdult: boolean; enabled: boolean;
  imageMode: 'direct' | 'proxy' | 'custom'; customProxy: string; onPick: (work: RecommendedWork, tab: 'details' | 'sources') => void;
  hideUnknownType?: boolean;
}) {
  const root = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const [failedPosters, setFailedPosters] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (!root.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '100px' });
    observer.observe(root.current); return () => observer.disconnect();
  }, []);
  const sourceKey = JSON.stringify(sources.map(s => [s.key, s.url, s.isAdult]));
  const primary = useQuery({
    queryKey: ['recommendation-card-metadata-v1', workKey(work), sourceKey, filterAdult, 'primary'],
    queryFn: ({ signal }) => enrichCard(() => api.workResources(work, sources.slice(0, 2), filterAdult, signal, true), signal),
    enabled: visible && enabled && sources.length > 0,
    staleTime: 10 * 60_000, retry: false, refetchOnWindowFocus: false,
  });
  const primaryInfo = recommendationCardInfo(work, primary.data?.items);
  const fallback = useQuery({
    queryKey: ['recommendation-card-metadata-v1', workKey(work), sourceKey, filterAdult, 'fallback'],
    queryFn: ({ signal }) => enrichCard(() => api.workResources(work, sources.slice(2, 4), filterAdult, signal, true), signal),
    enabled: visible && enabled && sources.length > 2 && (primary.isSuccess || primary.isError)
      && !primaryInfo.posters.some(url => !failedPosters.has(url)),
    staleTime: 10 * 60_000, retry: false, refetchOnWindowFocus: false,
  });
  const { metadata, posters, sourceCount } = recommendationCardInfo(work, [...(primary.data?.items || []), ...(fallback.data?.items || [])]);
  const poster = posters.find(url => !failedPosters.has(url));
  const onExhausted = useCallback(() => {
    if (poster) setFailedPosters(previous => new Set([...previous, poster]));
  }, [poster]);
  const pick = (tab: 'details' | 'sources') => onPick({ ...work, reasons, poster: poster || work.poster, metadata }, tab);
  const reasons = work.reasons.map(reason => reason.replace(/^(?:AI 推荐|DeepSeek 推荐)\s*[·：:]?\s*/i, ''));
  const summary = [work.year, metadata.area, metadata.genre].filter(Boolean).join(' · ');
  return <article ref={root} className="group min-w-0" aria-label={`推荐影片：${work.title}`}>
    <button type="button" onClick={() => pick('details')} className="block w-full rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-4 focus-visible:ring-offset-page" aria-label={`查看《${work.title}》的影片详情`}>
      <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-chip ring-1 ring-inset ring-white/5">
        <FilmPoster title={work.title} year={work.year} url={poster} mode={imageMode} customProxy={customProxy} onExhausted={onExhausted} />
        {(!hideUnknownType || work.mediaType !== 'unknown') && <MediaTypeLabel type={work.mediaType} overlay />}
        {metadata.rating && <span className="absolute left-2 top-2 flex items-baseline gap-1 rounded-md bg-black/75 px-1.5 py-1 text-amber-300 backdrop-blur-sm" aria-label={`${metadata.ratingSource || '豆瓣'}评分 ${metadata.rating}`}>
          <span className="text-[10px]">{metadata.ratingSource || '豆瓣'}</span><span className="text-xs font-semibold tabular-nums">{metadata.rating}</span>
        </span>}
      </div>
      <h3 className="mt-2.5 truncate text-sm font-semibold leading-5 text-content group-hover:text-accent" title={work.title}>{work.title}</h3>
    </button>
    <div className="pt-1">
      <p className="h-4 truncate text-xs leading-4 text-faint" title={summary}>{summary}</p>
      <p className="mt-2 h-10 line-clamp-2 text-xs leading-5 text-muted" title={reasons.join('；')}>{reasons[0]}</p>
      <div className="mt-1 flex h-8 items-center justify-between gap-2 text-xs">
        <button type="button" onClick={() => pick('details')} className="py-1 text-muted hover:text-content" aria-label={`查看《${work.title}》的完整资料`}>详情</button>
        <button type="button" onClick={() => pick('sources')} className="truncate py-1 text-accent hover:underline" aria-label={`查找《${work.title}》的播放资源`}>
          {sourceCount ? `${sourceCount} 个来源` : '查找片源'}<span aria-hidden="true" className="ml-1">→</span>
        </button>
      </div>
    </div>
  </article>;
}

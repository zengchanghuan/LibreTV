'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { recommendationCardInfo } from '@/lib/film-card-metadata';
import { createTaskPool } from '@/lib/task-pool';
import { workKey, type RecommendedWork } from '@/lib/recommendations';
import type { SourceConfig } from '@/lib/types';
import { FilmCardDetails } from './film-card-details';
import { MediaTypeLabel } from './media-type-label';
import { SmartImage } from './smart-image';

const enrichCard = createTaskPool(2);

export function RecommendedWorkCard({ work, sources, filterAdult, enabled, imageMode, customProxy, onPick }: {
  work: RecommendedWork; sources: SourceConfig[]; filterAdult: boolean; enabled: boolean;
  imageMode: 'direct' | 'proxy' | 'custom'; customProxy: string; onPick: (work: RecommendedWork) => void;
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
  const pick = () => onPick({ ...work, poster: poster || work.poster, metadata });
  const loading = primary.isFetching || fallback.isFetching;
  return <article ref={root} className="card overflow-hidden" aria-label={`推荐影片：${work.title}`}>
    <button type="button" onClick={pick} className="group block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40" aria-label={`查找《${work.title}》的播放资源`}>
      <div className="relative aspect-[2/3] bg-chip overflow-hidden">
        {poster ? <SmartImage key={poster} url={poster} mode={poster.startsWith('/') ? 'direct' : imageMode} customProxy={customProxy}
          alt={`《${work.title}》海报`} onExhausted={onExhausted} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
          : <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-faint">
            <span className="text-sm font-medium text-muted">{work.title}</span><span>{loading ? '正在补齐封面…' : '暂无可用封面'}</span>
          </div>}
        <MediaTypeLabel type={work.mediaType} overlay />
      </div>
      <h3 className="px-2.5 pt-2.5 text-sm font-medium text-content line-clamp-2 group-hover:text-accent" title={work.title}>{work.title}</h3>
    </button>
    <div className="p-2.5 pt-1">
      <FilmCardDetails metadata={metadata} year={work.year} compact />
      <p className="mt-2 text-xs text-accent" title={work.reasons.join('；')}>{work.reasons.join('；')}</p>
      <button type="button" onClick={pick} className="mt-3 text-left text-xs text-muted hover:text-accent">
        {sourceCount ? `已找到 ${sourceCount} 个来源 · 查看更多` : '查找播放资源'}
      </button>
    </div>
  </article>;
}

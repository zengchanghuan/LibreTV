'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { useAppStore } from '@/lib/store';
import type { SourceConfig } from '@/lib/types';
import { buildWatchUrl } from '@/lib/utils';
import { SmartImage } from './smart-image';

export function RelatedVideos({ source, vodId, ready, section }: {
  source: SourceConfig;
  vodId: string;
  ready: boolean;
  section?: 'hd';
}) {
  const filterAdult = useAppStore((state) => state.yellowFilter);
  const imageProxyMode = useAppStore((state) => state.imageProxyMode);
  const customImageProxy = useAppStore((state) => state.customImageProxy);
  const query = useQuery({
    queryKey: ['related-v2', source.key, source.url, source.name, Boolean(source.isAdult), vodId, filterAdult],
    queryFn: ({ signal }) => api.related(vodId, source, filterAdult, signal),
    enabled: Boolean(vodId && ready),
    staleTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  if (!vodId) return null;
  const items = query.data?.items ?? [];

  return (
    <section className="mt-8 border-t border-line pt-5" aria-labelledby="related-videos-heading" aria-busy={query.isFetching}>
      <h2 id="related-videos-heading" className="text-base font-semibold text-content">相关推荐</h2>
      <p className="mt-1 mb-4 text-xs text-faint">根据当前影片的类型、导演、主演和系列片名推荐</p>
      {query.isPending ? (
        <div role="status" aria-label="正在加载相关推荐" className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="aspect-[2/3] bg-chip rounded-lg animate-pulse" />
          ))}
        </div>
      ) : query.isError ? (
        <div className="flex items-center gap-3 py-4 text-sm text-muted" role="status">
          相关推荐暂时加载失败
          <button className="btn-ghost btn-sm" disabled={query.isFetching} onClick={() => void query.refetch()}>重试</button>
        </div>
      ) : (
        <>
          {items.length ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              {items.map((item) => (
                <Link
                  key={`${item.sourceKey}:${item.vodId}`}
                  href={buildWatchUrl({ section, sourceKey: item.sourceKey, sourceUrl: item.sourceUrl, detail: source.detail, vodId: item.vodId, title: item.name, index: 0 })}
                  prefetch={false}
                  className="card group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  <div className="relative aspect-[2/3] bg-chip overflow-hidden">
                    <span className="absolute inset-0 flex items-center justify-center text-xs text-faint">暂无封面</span>
                    {item.pic && <SmartImage url={item.pic} mode={imageProxyMode} customProxy={customImageProxy} alt={item.name} className="relative w-full h-full object-cover transition-transform group-hover:scale-105" />}
                  </div>
                  <div className="p-2.5">
                    <h3 className="text-sm font-medium text-content truncate" title={item.name}>{item.name}</h3>
                    <p className="mt-1 text-xs text-faint truncate">{[item.year, item.typeName].filter(Boolean).join(' · ') || item.sourceName}</p>
                    <p className="mt-2 text-xs text-accent line-clamp-2" title={item.reasons.join('；')}>{item.reasons.join('；')}</p>
                  </div>
                </Link>
              ))}
            </div>
          ) : <p className="py-4 text-sm text-muted">暂未找到相关影片</p>}
          {query.data?.partial && (
            <div className="flex items-center gap-2 mt-3 text-xs text-muted">
              部分推荐未能加载
              <button className="btn-ghost btn-sm" disabled={query.isFetching} onClick={() => void query.refetch()}>重试</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

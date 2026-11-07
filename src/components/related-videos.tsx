'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { isInDisabledSubscription, isSourceDisabled, resolveSource, useAppStore } from '@/lib/store';
import { sourcesForSection } from '@/lib/hd-sources';
import { seedWork, type RecommendedWork } from '@/lib/recommendations';
import { MEDIA_TYPE_LABELS } from '@/lib/media-type';
import { validateSourceUrl } from '@/lib/utils';
import type { SourceConfig, VideoInfo } from '@/lib/types';
import { SmartImage } from './smart-image';
import { RecommendedWorkSources } from './recommended-work-sources';

export function RelatedVideos({ source, vodId, ready, section, info }: {
  source: SourceConfig; vodId: string; ready: boolean; section?: 'hd'; info?: VideoInfo;
}) {
  const store = useAppStore();
  const filterAdult = store.yellowFilter;
  const [selected, setSelected] = useState<RecommendedWork | null>(null);
  const [visible, setVisible] = useState(false);
  const root = useRef<HTMLElement>(null);
  const close = useCallback(() => setSelected(null), []);
  const sources = useMemo(() => {
    const urls = new Set<string>();
    return sourcesForSection(store.selectedKeys.map(key => resolveSource(store, key)).filter((s): s is SourceConfig => {
      if (!s || !validateSourceUrl(s.url) || urls.has(s.url) || isSourceDisabled(store, s.key)
        || isInDisabledSubscription(store, s.key) || (filterAdult && s.isAdult)) return false;
      urls.add(s.url); return true;
    }), section || 'all').sort((a, b) => Number(b.key === source.key) - Number(a.key === source.key));
    // Source health/preferences, not player progress, determine the search scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.selectedKeys, store.customAPIs, store.envSources, store.sourceHealth, store.subscriptions, filterAdult, section, source.key]);
  const sourceKey = JSON.stringify(sources.map(s => [s.key, s.url, s.isAdult]));
  useEffect(() => {
    if (!root.current) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) setVisible(true); }, { rootMargin: '100px' });
    observer.observe(root.current); return () => observer.disconnect();
  }, []);
  const query = useQuery({
    queryKey: ['work-recommendations-v1', info?.title, info?.year, info?.typeName, info?.director, info?.actor, filterAdult],
    queryFn: ({ signal }) => api.recommendations(info!, filterAdult, signal, 'local'),
    enabled: Boolean(ready && info?.title), staleTime: 5 * 60_000, retry: false, refetchOnWindowFocus: false,
  });
  const ai = useQuery({
    queryKey: ['work-recommendations-ai-v1', info?.title, info?.year, info?.typeName, info?.director, info?.actor, filterAdult],
    queryFn: ({ signal }) => api.recommendations(info!, filterAdult, signal),
    enabled: Boolean(ready && info?.title && query.data?.aiAvailable),
    staleTime: 5 * 60_000, retry: false, refetchOnWindowFocus: false,
  });
  const fallback = useQuery({
    queryKey: ['related-v3-fallback', source, vodId, filterAdult],
    queryFn: ({ signal }) => api.related(vodId, source, filterAdult, signal),
    enabled: Boolean(ready && vodId && ((!info?.title) || query.isError || (query.isSuccess && !query.data.items.length
      && (!query.data.aiAvailable || ai.isError || (ai.isSuccess && !ai.data.items.length))))),
    staleTime: 5 * 60_000, retry: false, refetchOnWindowFocus: false,
  });
  const items = useMemo(() => ai.data?.items.length ? ai.data.items : query.data?.items.length ? query.data.items : (fallback.data?.items || [])
    .filter(item => /^(18|19|20)\d{2}$/.test(item.year || ''))
    .map(item => ({ ...seedWork({ ...item, title: item.name, cover: item.pic }), id: `source:${item.sourceKey}:${item.vodId}`,
      score: item.score, reasons: item.reasons })), [query.data, ai.data, fallback.data]);
  const preview = useQuery({
    queryKey: ['recommendation-resource-preview-v1', items.slice(0, 3).map(i => [i.id, i.year]), sourceKey, filterAdult],
    queryFn: async ({ signal }) => {
      const results: Record<string, number> = {};
      for (const work of items.slice(0, 3)) {
        signal.throwIfAborted();
        try {
          const result = await api.workResources(work, sources.slice(0, 2), filterAdult, signal);
          results[work.id] = new Set(result.items.map(i => i.sourceKey)).size;
        } catch { signal.throwIfAborted(); }
      }
      return results;
    },
    enabled: visible && !!items.length && !!sources.length && !selected,
    staleTime: 10 * 60_000, retry: false, refetchOnWindowFocus: false,
  });
  if (!vodId) return null;
  const loading = !ready || query.isFetching || (!items.length && (fallback.isFetching || ai.isFetching));
  const failed = !items.length && (fallback.isError || (query.isError && !fallback.isFetching));
  const partial = ai.data?.partial || fallback.data?.partial || ai.isError;
  return <section ref={root} className="mt-8 border-t border-line pt-5" aria-labelledby="related-videos-heading" aria-busy={loading}>
    <h2 id="related-videos-heading" className="text-base font-semibold text-content">相关推荐</h2>
    <p className="mt-1 mb-4 text-xs text-faint">按影片关联推荐，点击后在已启用的资源中选择播放来源</p>
    {!items.length && loading ? <div role="status" aria-label="正在加载相关推荐" className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
      {Array.from({ length: 6 }, (_, i) => <div key={i} className="aspect-[2/3] bg-chip rounded-lg animate-pulse" />)}
    </div> : failed ? <div className="py-4 text-sm text-muted" role="status">相关推荐暂时加载失败 <button className="btn-ghost btn-sm" onClick={() => { void query.refetch(); void fallback.refetch(); }}>重试</button></div>
      : items.length ? <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">{items.map(item => <button
        key={item.id} onClick={() => setSelected(item)} className="card group text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
        <div className="relative aspect-[2/3] bg-chip overflow-hidden"><span className="absolute inset-0 flex items-center justify-center text-xs text-faint">暂无封面</span>
          {item.poster && <SmartImage url={item.poster} mode={store.imageProxyMode} customProxy={store.customImageProxy} alt={item.title} className="relative w-full h-full object-cover transition-transform group-hover:scale-105" />}</div>
        <div className="p-2.5"><h3 className="text-sm font-medium text-content truncate" title={item.title}>{item.title}</h3>
          <p className="mt-1 text-xs text-faint">{item.year}{item.mediaType !== 'unknown' ? ` · ${MEDIA_TYPE_LABELS[item.mediaType]}` : ''}</p>
          <p className="mt-2 text-xs text-accent line-clamp-2" title={item.reasons.join('；')}>{item.reasons.join('；')}</p>
          <p className="mt-2 text-xs text-muted">{preview.data?.[item.id] ? `已找到 ${preview.data[item.id]} 个来源 · 查看更多` : '点击查找播放资源'}</p></div>
      </button>)}</div> : <p className="py-4 text-sm text-muted">暂未找到关联足够强的影片</p>}
    {partial && <p className="mt-3 text-xs text-muted">部分推荐暂未加载，已显示现有结果。<button className="btn-ghost btn-sm" disabled={loading || ai.isFetching} onClick={() => { if (query.data?.aiAvailable) void ai.refetch(); else void fallback.refetch(); }}>重试</button></p>}
    {selected && <RecommendedWorkSources key={`${selected.id}:${sourceKey}`} work={selected} sources={sources} section={section} onClose={close} />}
  </section>;
}

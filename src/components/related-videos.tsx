'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { isInDisabledSubscription, isSourceDisabled, resolveSource, useAppStore } from '@/lib/store';
import { sourcesForSection } from '@/lib/hd-sources';
import { seedWork, type RecommendedWork } from '@/lib/recommendations';
import { validateSourceUrl } from '@/lib/utils';
import type { SourceConfig, VideoInfo } from '@/lib/types';
import { RecommendedWorkCard } from './recommended-work-card';
import { RecommendedWorkSources } from './recommended-work-sources';

export function RelatedVideos({ source, vodId, ready, section, info }: {
  source: SourceConfig; vodId: string; ready: boolean; section?: 'hd'; info?: VideoInfo;
}) {
  const store = useAppStore();
  const filterAdult = store.yellowFilter;
  const [selected, setSelected] = useState<RecommendedWork | null>(null);
  const [selectedTab, setSelectedTab] = useState<'details' | 'sources'>('details');
  const queryClient = useQueryClient();
  const close = useCallback(() => setSelected(null), []);
  const pick = useCallback((work: RecommendedWork, tab: 'details' | 'sources') => {
    setSelectedTab(tab); setSelected(work);
  }, []);
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
    if (selected) void queryClient.cancelQueries({ queryKey: ['recommendation-card-metadata-v1'] });
  }, [selected, queryClient]);
  const query = useQuery({
    queryKey: ['work-recommendations-v2', info?.title, info?.year, info?.typeName, info?.director, info?.actor, filterAdult],
    queryFn: ({ signal }) => api.recommendations(info!, filterAdult, signal, 'local'),
    enabled: Boolean(ready && info?.title), staleTime: 5 * 60_000, retry: false, refetchOnWindowFocus: false,
  });
  const ai = useQuery({
    queryKey: ['work-recommendations-ai-v2', info?.title, info?.year, info?.typeName, info?.director, info?.actor, filterAdult],
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
  if (!vodId) return null;
  const loading = !ready || query.isFetching || (!items.length && (fallback.isFetching || ai.isFetching));
  const failed = !items.length && (fallback.isError || (query.isError && !fallback.isFetching));
  const partial = ai.data?.partial || fallback.data?.partial || ai.isError;
  return <section className="mt-8 border-t border-line pt-5" aria-labelledby="related-videos-heading" aria-busy={loading}>
    <h2 id="related-videos-heading" className="text-base font-semibold text-content">相关推荐</h2>
    <p className="mt-1 mb-4 text-xs text-faint">点击海报查看影片资料，也可直接查找播放来源</p>
    {!items.length && loading ? <div role="status" aria-label="正在加载相关推荐" className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-x-3 gap-y-6">
      {Array.from({ length: 6 }, (_, i) => <div key={i} className="aspect-[2/3] bg-chip rounded-lg animate-pulse" />)}
    </div> : failed ? <div className="py-4 text-sm text-muted" role="status">相关推荐暂时加载失败 <button className="btn-ghost btn-sm" onClick={() => { void query.refetch(); void fallback.refetch(); }}>重试</button></div>
      : items.length ? <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-x-3 gap-y-6">{items.map(item => <RecommendedWorkCard
        key={`${item.id}:${sourceKey}:${filterAdult}:${store.imageProxyMode}:${store.customImageProxy}`}
        work={item} sources={sources} filterAdult={filterAdult} enabled={!selected}
        imageMode={store.imageProxyMode} customProxy={store.customImageProxy} onPick={pick} />)}</div> : <p className="py-4 text-sm text-muted">暂未找到关联足够强的影片</p>}
    {partial && <p className="mt-3 text-xs text-muted">部分推荐暂未加载，已显示现有结果。<button className="btn-ghost btn-sm" disabled={loading || ai.isFetching} onClick={() => { if (query.data?.aiAvailable) void ai.refetch(); else void fallback.refetch(); }}>重试</button></p>}
    {selected && <RecommendedWorkSources key={`${selected.id}:${sourceKey}`} work={selected} sources={sources} section={section} initialTab={selectedTab} onClose={close} />}
  </section>;
}

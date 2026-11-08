'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { homeDay } from '@/lib/home-discovery-types';
import { useAppStore } from '@/lib/store';
import type { RecommendedWork } from '@/lib/recommendations';
import type { SourceConfig } from '@/lib/types';
import { HomeContinue } from './home-continue';
import { RecommendedWorkCard } from './recommended-work-card';
import { RecommendedWorkSources } from './recommended-work-sources';
import { SmartImage } from './smart-image';

export function HomeDiscovery({ sources, section, onCollection, charts }: {
  sources: SourceConfig[]; section?: 'hd'; onCollection: (id: string) => void; charts: React.ReactNode;
}) {
  const store = useAppStore();
  const [day, setDay] = useState(() => homeDay());
  const [batch, setBatch] = useState(0), [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<{ work: RecommendedWork; tab: 'details' | 'sources' } | null>(null);
  const close = useCallback(() => setSelected(null), []);
  useEffect(() => {
    const timer = setInterval(() => setDay(homeDay()), 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => { setBatch(0); setExpanded(false); setSelected(null); }, [day, store.yellowFilter]);
  const query = useQuery({
    queryKey: ['home-discovery-v1', day, store.yellowFilter],
    queryFn: ({ signal }) => api.homeRecommendations(store.yellowFilter, signal),
    staleTime: 60_000, retry: 1,
    refetchInterval: q => q.state.data?.aiStatus === 'pending' ? 4000 : 60_000,
    refetchIntervalInBackground: false,
  });
  const data = query.data, items = data?.batches[batch % (data.batches.length || 1)] || [];
  return <div>
    <HomeContinue />
    <section aria-label="今日精选" className="mb-10">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div><p className="mb-1 text-[10px] font-semibold tracking-[0.18em] text-accent">DAILY PICKS</p>
          <h2 className="text-xl font-semibold">今日精选</h2><p className="mt-1 text-xs text-muted">{items.length || 12} 部值得慢慢挑的好电影 · 每日更新</p></div>
        <button className="btn-ghost btn-sm shrink-0" disabled={!data || data.batches.length < 2} onClick={() => { setBatch(b => (b + 1) % (data?.batches.length || 1)); setExpanded(false); }}>换一批 ↻</button>
      </div>
      {query.isLoading && <div role="status" aria-label="正在加载今日精选" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{Array.from({ length: 6 }, (_, i) => <div key={i} className="aspect-[2/3] animate-pulse rounded-xl bg-chip" />)}</div>}
      {query.isError && !data && <p className="rounded-xl bg-chip p-5 text-sm text-muted" role="status">精选暂时加载失败。<button className="btn-ghost btn-sm" onClick={() => void query.refetch()}>重试</button></p>}
      {!!items.length && <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-6">{(expanded ? items : items.slice(0, 6)).map(work => <RecommendedWorkCard
        key={work.id} work={work} sources={sources} filterAdult={store.yellowFilter} enabled={false} hideUnknownType
        imageMode={store.imageProxyMode} customProxy={store.customImageProxy} onPick={(work, tab) => setSelected({ work, tab })} />)}</div>}
      {items.length > 6 && <div className="mt-3 text-center"><button className="btn-ghost btn-sm" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>{expanded ? '收起' : `展开全部 ${items.length} 部`} {expanded ? '↑' : '↓'}</button></div>}
      {data?.aiStatus === 'pending' && <p className="mt-3 text-xs text-faint" role="status">精选已就绪，正在补充相似影片…</p>}
      {data?.aiStatus === 'ready' && <p className="mt-3 text-xs text-faint">包含 DeepSeek 推荐 · 片名与年份已核验</p>}
      {data?.aiStatus === 'fallback' && <p className="mt-3 text-xs text-faint">AI 扩展暂未就绪，已显示精选片单。</p>}
    </section>
    {!!data?.collections.length && <section aria-label="本周专题" className="mb-10">
      <div className="mb-4 flex items-center justify-between gap-3"><div><p className="mb-1 text-[10px] font-semibold tracking-[0.18em] text-accent">COLLECTIONS</p><h2 className="text-xl font-semibold">本周专题</h2></div>
        <button className="btn-ghost btn-sm" onClick={() => onCollection('topics')}>全部片单 →</button></div>
      <div className="grid gap-3 sm:grid-cols-3">{data.collections.map(c => <button key={c.id} onClick={() => onCollection(c.id)} className="group flex min-w-0 gap-3 overflow-hidden rounded-xl border border-line bg-surface p-4 text-left transition-colors hover:bg-hover">
        <div className="min-w-0 flex-1"><h3 className="text-sm font-semibold group-hover:text-accent">{c.name}</h3><p className="mt-2 line-clamp-2 text-xs leading-5 text-muted">{c.intro}</p><p className="mt-3 text-xs text-accent">{c.count} 部作品 →</p></div>
        {c.poster && <div className="w-16 shrink-0 self-center overflow-hidden rounded-lg"><SmartImage url={c.poster} mode={c.poster.startsWith('/') ? 'direct' : store.imageProxyMode} customProxy={store.customImageProxy} alt="" className="aspect-[2/3] w-full object-cover" /></div>}
      </button>)}</div>
    </section>}
    <section aria-label="热门榜单" className="mb-8"><p className="mb-1 text-[10px] font-semibold tracking-[0.18em] text-accent">WEEKLY CHARTS</p>
      <h2 className="mb-4 text-xl font-semibold">本周热门</h2>{charts}</section>
    {selected && <RecommendedWorkSources key={`${selected.work.id}:${store.yellowFilter}`} work={selected.work} initialTab={selected.tab} sources={sources} section={section} onClose={close} />}
  </div>;
}

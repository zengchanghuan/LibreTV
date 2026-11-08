'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '@/lib/store';
import type { RecommendedWork } from '@/lib/recommendations';
import type { SourceConfig } from '@/lib/types';
import type { DiscoveryResponse, RecentTab } from '@/lib/discovery-types';
import { discoveryStarters, starterEditorial } from '@/lib/discovery-starters';
import { useAuth } from './auth';
import { HomeContinue } from './home-continue';
import { RecommendedWorkCard } from './recommended-work-card';
import { RecommendedWorkSources } from './recommended-work-sources';
import { SmartImage } from './smart-image';
import { FilmPoster } from './film-poster';

const tabs: { id: RecentTab; label: string }[] = [{ id: 'new', label: '新片上线' }, { id: 'series', label: '剧集更新' }, { id: 'added', label: '最近收录' }];
const dateLabel = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
export function HomeDiscovery({ sources, section, onCollection, charts }: {
  sources: SourceConfig[]; section?: 'hd'; onCollection: (id: string) => void; charts: React.ReactNode;
}) {
  const store = useAppStore();
  const { verified } = useAuth();
  const [chosenTab, setTab] = useState<RecentTab | null>(null), [expanded, setExpanded] = useState(false);
  const [issueIndex, setIssueIndex] = useState(0), [showIssue, setShowIssue] = useState(false);
  const [showCharts, setShowCharts] = useState(false);
  const [selected, setSelected] = useState<{ work: RecommendedWork; tab: 'details' | 'sources' } | null>(null);
  const close = useCallback(() => setSelected(null), []);
  const pick = (work: RecommendedWork, tab: 'details' | 'sources' = 'details') => setSelected({ work, tab });
  const sourceKeys = [...new Set(sources.map(s => s.key))].sort().join(',');
  useEffect(() => { setTab(null); setExpanded(false); }, [sourceKeys]);
  const query = useQuery({
    queryKey: ['home-discovery-v2', sourceKeys, store.yellowFilter], enabled: verified,
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/home/discovery?${new URLSearchParams({ sources: sourceKeys })}`, { signal, credentials: 'same-origin' });
      if (!response.ok) throw new Error('首页内容暂不可用');
      return await response.json() as DiscoveryResponse;
    }, staleTime: 60_000, retry: 1,
    refetchInterval: q => q.state.data?.refreshedAt ? 60_000 : 5000,
    refetchIntervalInBackground: false,
  });
  const data = query.data;
  const tab = chosenTab || (data?.recent.new.length ? 'new' : data?.recent.series.length ? 'series' : 'added');
  const cards = data?.recent[tab] || [], issue = data?.editorial[issueIndex % (data?.editorial.length || 1)] || starterEditorial;
  const starterCards = (works: RecommendedWork[], compact = false) => <div className={compact ? 'grid grid-cols-3 gap-3' : 'grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-6'}>{works.map(work => <article key={work.id} className="min-w-0">
    <button className="block w-full text-left" onClick={() => pick(work)} aria-label={`查看《${work.title}》的影片详情`}>
      <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-chip"><FilmPoster title={work.title} year={work.year} url={work.poster} mode={store.imageProxyMode} customProxy={store.customImageProxy} /><span className="absolute left-2 top-2 rounded bg-black/75 px-2 py-1 text-[10px] text-white">精选推荐</span></div>
      <h3 className="mt-2 truncate text-sm font-semibold">{work.title}</h3>
    </button><p className="mt-1 truncate text-xs text-faint">{work.year} · {work.genres[0] || '电影'}</p>
    <button className="mt-2 py-1 text-xs text-accent" onClick={() => pick(work, 'sources')}>查找片源 →</button>
  </article>)}</div>;
  return <div>
    <HomeContinue />
    {query.isError && <div className="mb-6 rounded-xl bg-chip p-4 text-sm text-muted" role="status">首页内容暂时加载失败。<button className="btn-ghost btn-sm" onClick={() => void query.refetch()}>重试</button></div>}
    {data?.enabled.recent !== false && <section aria-label="近期内容" className="mb-10">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div><p className="mb-1 text-[10px] tracking-[0.18em] text-accent">NEW & UPDATING</p><h2 className="text-xl font-semibold">最近，有什么新片？</h2>
          <p className="mt-1 text-xs text-faint">{data?.refreshedAt ? `数据截至 ${dateLabel(data.refreshedAt)} · 北京时间` : '正在整理已配置片源中的近期内容'}</p></div>
        {cards.length > 6 && <button className="btn-ghost btn-sm shrink-0" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>{expanded ? '收起 ↑' : '查看全部 →'}</button>}
      </div>
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="近期内容分类">{tabs.map(t => <button key={t.id} className={tab === t.id ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'} aria-pressed={tab === t.id} onClick={() => { setTab(t.id); setExpanded(false); }}>{t.label}</button>)}</div>
      {(data?.partial || data?.stale) && <p className="mb-4 rounded-lg bg-chip p-3 text-xs text-muted" role="status">部分来源暂未更新，已保留仍有效的收录信息。超过 24 小时未核对的片源不会计入。</p>}
      {cards.length ? <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-6">{cards.slice(0, expanded ? 48 : 6).map(card => <article key={card.work.id} className="min-w-0">
          <button type="button" className="w-full text-left" onClick={() => pick(card.work)} aria-label={`查看《${card.work.title}》的影片详情`}>
            <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-chip">
              <FilmPoster title={card.work.title} year={card.work.year} url={card.work.poster} mode={store.imageProxyMode} customProxy={store.customImageProxy} />
              <span className="absolute left-2 top-2 rounded bg-black/75 px-2 py-1 text-[10px] text-white">{tab === 'new' ? '近期上线' : tab === 'series' ? '追剧更新' : '最近收录'}</span>
            </div><h3 className="mt-2 truncate text-sm font-semibold" title={card.work.title}>{card.work.title}</h3>
          </button>
          <p className="mt-1 truncate text-xs text-faint">{card.work.year} · {card.work.genres.slice(0, 2).join(' / ') || '影视'}</p>
          <p className="mt-1 text-xs text-muted">{tab === 'series' ? card.label : `${dateLabel(card.date).split(' ')[0]} ${tab === 'new' ? '上线' : '收录'}`}</p>
          <button className="mt-2 py-1 text-xs text-accent" onClick={() => pick(card.work, 'sources')}>已收录 {card.sourceCount} 个片源 →</button>
        </article>)}</div> : <div>
          <p className="mb-4 text-xs leading-6 text-muted" role="status">{!data && !query.isError ? '近期内容正在整理，先看这些精选影片。' : query.isError ? '近期内容暂时加载失败，仍可浏览以下精选影片。' : tab === 'new' ? '暂未找到日期核对通过的新片，先看看精选片单。' : tab === 'series' ? '暂未发现新增剧集，先看看精选片单。' : !sourceKeys ? '选择片源后可查看近期收录，现在可先浏览精选影片。' : '近期内容正在整理，先看这些精选影片。'}</p>
          {starterCards(discoveryStarters.slice(0, 6))}
        </div>}
      <p className="mt-3 text-xs text-faint">{tab === 'new' ? '按明确上线日期排序；日期不完整或有冲突的影片只列入最近收录。' : tab === 'series' ? '新增剧集才算更新，更换海报或播放地址不会重新排到前面。' : '收录日期是本站首次发现时间，不代表影片首映日期。'}</p>
    </section>}
    <div className="mb-10 grid gap-8 lg:grid-cols-2">
      {data?.enabled.popular !== false && <section aria-label="本站热门">
        <p className="mb-1 text-[10px] tracking-[0.18em] text-accent">{data?.popular.length ? 'WATCHED HERE' : 'START WATCHING'}</p><h2 className="text-xl font-semibold">{data?.popular.length ? '本站热门' : '先看这些'}</h2><p className="mt-1 mb-4 text-xs leading-6 text-faint">{data?.popular.length ? '近 7 天 · 按独立账号有效观看排序' : data?.popularStatus === 'unavailable' ? '热门榜暂不可用，先浏览精选推荐。' : '热门榜正在积累真实观看，先从精选好片开始。'}</p>
        {data?.popular.length ? <div>{data.popular.slice(0, 6).map((work, i) => <button key={work.id} className="flex w-full items-center gap-4 border-b border-line py-3 text-left" onClick={() => pick(work)}>
          <span className="w-8 shrink-0 text-2xl italic text-accent">{String(i + 1).padStart(2, '0')}</span><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{work.title}</strong><span className="mt-1 block text-xs text-faint">{work.year} · 多位观众有效观看</span></span><span className="text-xs text-muted">查看 →</span>
        </button>)}<p className="mt-3 text-xs text-faint">同一账号重复播放，不重复计算观看人数。</p></div>
          : starterCards(discoveryStarters.slice(6, 9), true)}
      </section>}
      {data?.enabled.editorial !== false && <section aria-label="编辑精选">
        <div className="mb-4 flex items-center justify-between gap-2"><div><p className="mb-1 text-[10px] tracking-[0.18em] text-accent">EDITOR&apos;S PICKS</p><h2 className="text-xl font-semibold">编辑精选</h2><p className="mt-1 text-xs text-faint">每周一个主题，把好电影连起来</p></div>
          {!!data?.editorial.length && data.editorial.length > 1 && <button className="btn-ghost btn-sm" onClick={() => { setIssueIndex(i => i + 1); setShowIssue(false); }}>换个主题 ↻</button>}</div>
        {issue ? <div className="relative min-h-56 overflow-hidden rounded-xl border border-line bg-surface p-6">
          {issue.works[0]?.poster && <div className="pointer-events-none absolute inset-y-0 right-0 w-2/5 opacity-20"><SmartImage url={issue.works[0].poster} mode={issue.works[0].poster.startsWith('/') ? 'direct' : store.imageProxyMode} customProxy={store.customImageProxy} alt="" className="h-full w-full object-cover" /></div>}
          <div className="relative"><p className="text-xs tracking-widest text-accent">{issue.publishedAt ? '本周主题' : '主题选片'}</p><h3 className="mt-4 font-serif text-3xl">{issue.title}</h3><p className="mt-3 max-w-xs text-sm leading-7 text-muted">{issue.intro}</p><button className="btn-primary btn-sm mt-5" aria-expanded={showIssue} onClick={() => setShowIssue(v => !v)}>{showIssue ? '收起片单 ↑' : `打开片单 · ${issue.works.length} 部 →`}</button></div>
        </div> : <div className="min-h-56 rounded-xl bg-chip p-6 text-sm text-muted">{query.isLoading ? '正在加载精选片单…' : '精选片单暂不可用。'}</div>}
        <p className="mt-3 text-xs text-faint">主题选片 · 已发布的片单保持稳定，每周轮换。</p>
      </section>}
    </div>
    {showIssue && issue && <section className="mb-10" aria-label={issue.title}><h3 className="mb-4 text-lg font-semibold">{issue.title}</h3><div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-6">{issue.works.map(work => <RecommendedWorkCard key={work.id} work={work} sources={sources} filterAdult={store.yellowFilter} enabled={false} hideUnknownType imageMode={store.imageProxyMode} customProxy={store.customImageProxy} onPick={pick} />)}</div></section>}
    <button className="mb-6 flex w-full items-center justify-between gap-4 rounded-xl border border-line bg-surface p-5 text-left" onClick={() => onCollection('topics')}><span><strong className="text-sm">还想再逛逛？</strong><span className="mt-1 block text-xs text-muted">主题片单、导演作品与演员作品都在这里。</span></span><span className="shrink-0 text-xs text-accent">全部片单 →</span></button>
    <details className="mb-8" onToggle={event => setShowCharts(event.currentTarget.open)}><summary className="cursor-pointer py-3 text-sm">更多参考榜单 <span className="ml-2 text-xs text-faint">豆瓣口碑 · 百度热搜</span></summary>{showCharts && <div className="mt-4">{charts}</div>}</details>
    {selected && <RecommendedWorkSources key={`${selected.work.id}:${store.yellowFilter}`} work={selected.work} initialTab={selected.tab} sources={sources} section={section} onClose={close} />}
  </div>;
}

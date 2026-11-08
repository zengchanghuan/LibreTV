'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client-api';
import { useAppStore } from '@/lib/store';
import { buildWatchUrl } from '@/lib/utils';
import { recommendationCardInfo } from '@/lib/film-card-metadata';
import type { RecommendedWork, ResourceMatch } from '@/lib/recommendations';
import type { SourceConfig } from '@/lib/types';
import { useFocusTrap } from './use-focus-trap';
import { useRankedSources } from './use-ranked-sources';
import { FilmCardDetails } from './film-card-details';
import { Icon } from './icon';

export function RecommendedWorkSources({ work, sources, section, initialTab = 'sources', onClose }: {
  work: RecommendedWork; sources: SourceConfig[]; section?: 'hd'; initialTab?: 'details' | 'sources'; onClose: () => void;
}) {
  const filterAdult = useAppStore(s => s.yellowFilter), router = useRouter();
  const panel = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ items: ResourceMatch[]; checked: number; failed: number; loading: boolean }>({ items: [], checked: 0, failed: 0, loading: true });
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState(initialTab);
  const sourcesKey = JSON.stringify(sources);
  // Probe only three sources for this explicitly selected work, never for background cards.
  const quality = useRankedSources(state.items.slice(0, 3), tab === 'sources' && !state.loading);
  useFocusTrap(true, panel);
  useEffect(() => {
    const previous = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', close);
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', close); };
  }, [onClose]);
  useEffect(() => {
    const controller = new AbortController();
    setState({ items: [], checked: 0, failed: 0, loading: true });
    void (async () => {
      const configured = JSON.parse(sourcesKey) as SourceConfig[];
      for (let offset = 0; offset < configured.length; offset += 6) {
        if (controller.signal.aborted) return;
        const batch = configured.slice(offset, offset + 6);
        try {
          const result = await api.workResources(work, batch, filterAdult, controller.signal, true);
          if (controller.signal.aborted) return;
          setState(s => ({ ...s, items: [...s.items, ...result.items], checked: s.checked + result.checked, failed: s.failed + result.failures.length }));
        } catch {
          if (controller.signal.aborted) return;
          setState(s => ({ ...s, checked: s.checked + batch.length, failed: s.failed + batch.length }));
        }
      }
      if (!controller.signal.aborted) setState(s => ({ ...s, loading: false }));
    })();
    return () => controller.abort();
  }, [work, sourcesKey, filterAdult, attempt]);

  const play = (item: ResourceMatch) => {
    const source = sources.find(s => s.key === item.sourceKey && new URL(s.url).href === new URL(item.sourceUrl || s.url).href);
    onClose();
    router.push(buildWatchUrl({ section, sourceKey: item.sourceKey, sourceUrl: item.sourceUrl, detail: source?.detail,
      vodId: item.vodId, title: item.name, index: 0 }));
  };
  const sorted = [...quality.ranked.map(item => state.items.find(i => i === item)!), ...state.items.slice(3)];
  const best = quality.best as ResourceMatch | undefined;
  const { metadata } = recommendationCardInfo(work, state.items);
  const sourceCount = new Set(state.items.map(i => i.sourceKey)).size;
  return <div className="fixed inset-0 z-[65] flex items-end justify-center bg-black/70 sm:items-center sm:p-6" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    {/* Artplayer's default mini-player layer (9999) must stay below an open dialog. */}
    <style jsx global>{`.art-mini-popup { z-index: 40 !important; }`}</style>
    <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`${work.title} 的影片详情与播放资源`} className="flex max-h-[90dvh] w-full max-w-2xl flex-col rounded-t-2xl border border-line bg-surface-raised shadow-2xl outline-none sm:max-h-[85dvh] sm:rounded-2xl">
      <div className="flex shrink-0 items-start justify-between gap-3 px-5 pb-4 pt-5">
        <div className="min-w-0"><p className="mb-1 text-xs text-faint">影片详情</p><h2 className="text-xl font-semibold text-content">{work.title}<span className="ml-2 text-sm font-normal text-muted">{work.year}</span></h2></div>
        <button type="button" className="btn-ghost shrink-0 !p-2" aria-label="关闭影片详情" onClick={onClose}><Icon name="close" /></button>
      </div>
      <div className="flex shrink-0 gap-6 border-b border-line px-5" aria-label="详情内容切换">
        {(['details', 'sources'] as const).map(value => <button type="button" key={value} aria-pressed={tab === value} onClick={() => setTab(value)}
          className={`border-b-2 pb-3 text-sm font-medium ${tab === value ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-content'}`}>
          {value === 'details' ? '影片资料' : `播放来源${sourceCount ? ` · ${sourceCount}` : ''}`}
        </button>)}
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain p-5">
      {tab === 'details' ? <section aria-label="完整影片资料">
        <FilmCardDetails metadata={metadata} year={work.year} spacious />
        {work.reasons.length > 0 && <div className="mt-5 rounded-xl bg-chip/60 p-4">
          <h3 className="mb-2 text-sm font-medium text-content">推荐理由</h3>
          <ul className="space-y-2 text-sm leading-6 text-muted">{work.reasons.map((reason, index) => <li key={index}>{reason.replace(/^(?:AI 推荐|DeepSeek 推荐)\s*[·：:]?\s*/i, '')}</li>)}</ul>
        </div>}
        <button type="button" className="btn-primary mt-5 w-full" onClick={() => setTab('sources')}>查看播放来源</button>
      </section> : <section aria-label="播放来源">
      <p className="text-xs text-muted">已查询 {state.checked}/{sources.length} 个源 · 匹配到 {sourceCount} 个来源</p>
      {state.loading && <p className="mt-4 text-sm text-muted" role="status">正在分批搜索已启用的资源…</p>}
      {!sources.length && <p className="mt-4 text-sm text-muted">请先在源管理中启用点播源。</p>}
      {!state.loading && sources.length > 0 && !state.items.length && <p className="mt-4 text-sm text-muted">{state.failed ? '部分源未完成查询，暂未找到符合片名、年份和类型的资源。' : '在本次查询的源中暂未找到匹配资源。'}</p>}
      {state.failed > 0 && <div className="mt-3 flex gap-3 items-center text-sm text-muted"><span>{state.failed} 个源查询未完成</span><button className="btn-ghost btn-sm" disabled={state.loading} onClick={() => setAttempt(a => a + 1)}>重试查询</button></div>}
      {!!state.items.length && <>
        <div className="my-4 flex items-center justify-between gap-3"><p className="text-xs text-muted">{quality.testing ? '正在检测前三个来源的清晰度、字幕和速度…' : '资源匹配与播放检测分开；可选择来源播放。'}</p>
          <button className="btn-primary btn-sm shrink-0" disabled={!best} onClick={() => best && play(best)}>播放推荐来源</button></div>
        <div className="space-y-2">{sorted.map(item => <button key={`${item.sourceUrl}:${item.vodId}`} onClick={() => play(item)} className="block w-full rounded-lg border border-line p-3 text-left hover:bg-hover">
          <span className="text-sm text-content font-medium">{item.sourceName}</span>
          <span className="ml-2 text-xs text-muted">{item.year} · {item.typeName || '类型未标注'}</span>
          <p className="mt-1 text-xs text-faint">{quality.labelOf(item)}{item.typeUnconfirmed ? ' · 类型未核实' : ''}</p>
        </button>)}</div>
      </>}
      </section>}
      </div>
    </div>
  </div>;
}

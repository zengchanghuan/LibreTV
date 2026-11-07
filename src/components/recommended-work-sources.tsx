'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client-api';
import { useAppStore } from '@/lib/store';
import { buildWatchUrl } from '@/lib/utils';
import type { RecommendedWork, ResourceMatch } from '@/lib/recommendations';
import type { SourceConfig } from '@/lib/types';
import { useFocusTrap } from './use-focus-trap';
import { useRankedSources } from './use-ranked-sources';

export function RecommendedWorkSources({ work, sources, section, onClose }: {
  work: RecommendedWork; sources: SourceConfig[]; section?: 'hd'; onClose: () => void;
}) {
  const filterAdult = useAppStore(s => s.yellowFilter), router = useRouter();
  const panel = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ items: ResourceMatch[]; checked: number; failed: number; loading: boolean }>({ items: [], checked: 0, failed: 0, loading: true });
  const [attempt, setAttempt] = useState(0);
  const sourcesKey = JSON.stringify(sources);
  // Probe only three sources for this explicitly selected work, never for background cards.
  const quality = useRankedSources(state.items.slice(0, 3), !state.loading);
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
          const result = await api.workResources(work, batch, filterAdult, controller.signal);
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
  return <div className="fixed inset-0 z-[65] bg-black/80 overflow-y-auto px-4 py-10" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`${work.title} 的播放资源`} className="mx-auto max-w-2xl rounded-xl bg-surface-raised p-5 shadow-2xl outline-none">
      <div className="flex items-start justify-between gap-3">
        <div><h2 className="text-lg font-semibold text-content">{work.title}</h2><p className="text-sm text-muted mt-1">{work.year} · 已查询 {state.checked}/{sources.length} 个源 · 匹配到 {new Set(state.items.map(i => i.sourceKey)).size} 个来源</p></div>
        <button className="btn-ghost btn-sm" aria-label="关闭资源选择" onClick={onClose}>关闭</button>
      </div>
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
    </div>
  </div>;
}

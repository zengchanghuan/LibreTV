'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRankedSources } from './use-ranked-sources';
import { qualityLabel } from '@/lib/playback-quality';
import { api } from '@/lib/client-api';
import type { SourceConfig, SearchResultItem } from '@/lib/types';
import { buildWatchUrl, cn } from '@/lib/utils';
import { useAppStore, resolveSource } from '@/lib/store';
import { useToast } from './toast';
import { Icon } from './icon';
import { SmartImage } from './smart-image';
import { EmptyState, LoadingState } from './states';
import { useFocusTrap } from './use-focus-trap';

/**
 * 换源面板：跨源按标题搜索 → 匹配同名/同前缀资源 → 限并发媒体测速 + 本机实播记录 → 按质量排序展示。
 * 切换时保留当前集数索引（旧版 switchToResource 逻辑的去 DOM 化重写）。
 */

interface Candidate {
  source: SourceConfig;
  result: SearchResultItem;
  ms?: number;
  ok?: boolean;
  episodes?: number;
}

export function SwitchSourceModal({
  currentTitle,
  currentSourceKey,
  currentVodId,
  currentIndex,
  getCurrentPosition,
  onClose,
}: {
  currentTitle: string;
  currentSourceKey: string;
  currentVodId: string;
  currentIndex: number;
  getCurrentPosition?: () => number;
  onClose: () => void;
}) {
  const store = useAppStore();
  const router = useRouter();
  const { toast } = useToast();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [phase, setPhase] = useState<'searching' | 'done'>('searching');
  const quality = useRankedSources(candidates.map(c => c.result), phase === 'done', currentIndex);
  /** 封面加载失败记录（按卡片 key）；失败后降级为占位图标，避免破图 */
  const [imgFailed, setImgFailed] = useState<Record<string, boolean>>({});
  const panelRef = useRef<HTMLDivElement>(null);

  // 打开时把焦点移入弹窗、Tab 圈闭在弹窗内、关闭后归还焦点
  useFocusTrap(true, panelRef);

  const sources = useMemo(() => {
    // selectedKeys 可能含历史残留的重复 key：按 key 去重，避免同源重复搜索/测速与 React key 撞车
    const seen = new Set<string>();
    return store.selectedKeys
      .map((key) => resolveSource(store, key))
      .filter((s): s is SourceConfig => {
        if (!s || seen.has(s.key)) return false;
        seen.add(s.key);
        return true;
      });
  }, [store]);

  useEffect(() => {
    // 弹窗打开期间锁定背景滚动；Esc 关闭（与其它弹窗一致）
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  useEffect(() => {
    // 关闭弹窗时中止在途请求：否则 N 个源的搜索 + N 个详情测速会继续占用网络与后端
    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      // 1) 并行搜索所有选中源
      setPhase('searching');
      try {
        const { list } = await api.search(currentTitle, sources, store.yellowFilter, { signal: controller.signal });
        if (cancelled) return;

        // 匹配口径：优先完全同名，其次名称以标题开头（兼容「小偷 HD」「小偷[电影解说]」这类修饰名）。
        // 都没有则不展示该源——不再兜底取搜索第一条，避免把搜到的其他影片（如搜「小偷」
        // 命中的《宝贝 小偷与大盗》）误当成换源目标。
        const title = currentTitle.trim();
        const matched: Candidate[] = [];
        for (const s of sources) {
          const hits = list.filter((r) => r.sourceKey === s.key);
          const exact =
            hits.find((r) => (r.name || '').trim() === title) ??
            hits.find((r) => (r.name || '').trim().startsWith(title));
          if (exact) matched.push({ source: s, result: exact });
        }

        setCandidates(matched);
        setPhase('done');
      } catch (err) {
        // 主动中止不算失败，不提示
        const aborted = err instanceof DOMException && err.name === 'AbortError';
        if (!cancelled && !aborted) {
          toast(err instanceof Error ? err.message : '换源搜索失败', 'error');
          setPhase('done');
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTitle, store.yellowFilter]);

  const sorted = quality.ranked.map(item => {
    const candidate = candidates.find(c => c.result === item)!;
    const probe = quality.probes[`${item.sourceKey}:${item.vodId}`];
    return { ...candidate, ...probe };
  });
  const recommended = sorted.find(c => c.ok && !(c.source.key === currentSourceKey && c.result.vodId === currentVodId));

  const switchTo = (c: Candidate) => {
    if (!c.episodes) {
      toast('该源无可用播放资源', 'warning');
      return;
    }
    if (currentIndex >= c.episodes) { toast('该源缺少当前集', 'warning'); return; }
    const targetIndex = currentIndex;
    const currentPosition = getCurrentPosition?.() || 0;
    onClose(); // 先关闭面板，避免路由参数变化后弹窗残留旧数据
    router.push(
      buildWatchUrl({
        sourceKey: c.source.key,
        vodId: c.result.vodId,
        index: targetIndex,
        title: c.result.name || currentTitle,
        sourceUrl: c.source.url,
        detail: c.source.detail,
      }) + (currentPosition > 10 ? `&position=${Math.floor(currentPosition)}` : '')
    );
  };

  return (
    <div
      className="fixed inset-0 z-[65] flex items-start justify-center overflow-y-auto bg-black/80 py-10 px-4 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="bg-surface-raised rounded-xl w-full max-w-3xl shadow-2xl p-5 animate-slide-up outline-none"
        role="dialog"
        aria-modal="true"
        aria-label={`换源：${currentTitle}`}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-content truncate" title={currentTitle}>
              {currentTitle}
            </h2>
            <p className="text-xs text-faint">
              {phase === 'searching'
                ? '正在搜索各资源...'
                : quality.testing
                  ? '正在测试视频列表和媒体速度…'
                  : `共 ${sorted.length} 个来源 · ${sorted.filter((c) => c.ok).length} 个可用`}
            </p>
          </div>
          <button className="p-1.5 rounded-md text-muted hover:text-content hover:bg-hover" onClick={onClose} aria-label="关闭">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {phase === 'done' && <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-xs text-faint">优先推荐当前网络下起播快、卡顿少的来源；Wi-Fi 与移动网络表现可能不同。</p>
          <button className="btn-ghost btn-sm shrink-0" disabled={quality.testing} onClick={quality.retest}>重新测速</button>
          <button className="btn-primary btn-sm shrink-0" disabled={!recommended}
            onClick={() => recommended && switchTo(recommended)}>切换推荐源</button>
        </div>}
        {phase !== 'done' ? (
          <LoadingState label={phase === 'searching' ? '搜索各资源中...' : '测速中...'} />
        ) : sorted.length === 0 ? (
          <EmptyState variant="plain" title="其他点播源未找到同名资源" />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {sorted.map((c) => {
              const isCurrent = c.source.key === currentSourceKey && String(c.result.vodId) === String(currentVodId);
              const cardKey = `${c.source.key}_${c.result.vodId}`;
              const img = c.result.pic;
              const coverFailed = imgFailed[cardKey] ?? false;
              return (
                <button
                  key={`${c.source.key}_${c.result.vodId}`}
                  className={cn('text-left group relative rounded-lg overflow-hidden bg-card transition-transform', !isCurrent && 'hover:scale-[1.03] cursor-pointer', isCurrent && 'cursor-default')}
                  onClick={() => !isCurrent && switchTo(c)}
                  disabled={isCurrent}
                >
                  <div className="relative aspect-[2/3] bg-chip">
                    {img && !coverFailed ? (
                      <SmartImage
                        url={c.result.pic}
                        mode={store.imageProxyMode}
                        customProxy={store.customImageProxy}
                        alt={c.result.name}
                        className="w-full h-full object-cover"
                        onExhausted={() => setImgFailed((prev) => ({ ...prev, [cardKey]: true }))}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-faint">
                        <Icon name="link" className="w-6 h-6" />
                      </div>
                    )}
                    <span
                      className={cn(
                        'absolute top-1.5 right-1.5 tag',
                        c.ok === undefined ? 'bg-black/70 text-white' : !c.ok ? 'bg-danger-solid/85 text-white' : c.ms! > 2000 ? 'bg-warning-solid/85 text-white' : 'bg-success-solid/85 text-white'
                      )}
                    >
                      {c.ok === undefined ? '测速中' : !c.ok ? '测速未通过' : `媒体 ${(c.ms! / 1000).toFixed(1)}s`}
                    </span>
                    {isCurrent && (
                      <span className="absolute inset-x-0 bottom-0 bg-accent/90 text-on-accent text-xs text-center py-1">当前播放</span>
                    )}
                  </div>
                  <div className="p-2">
                    <div className="text-xs font-medium text-content truncate" title={c.source.name}>
                      {c.source.name}{recommended === c ? ' · 推荐' : ''}
                    </div>
                    <div className="text-xs text-faint mt-0.5">{qualityLabel(quality.entries[c.source.url])}</div>
                    <div className="text-xs text-faint">{c.episodes ? `${c.episodes} 集` : '待获取剧集'}</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

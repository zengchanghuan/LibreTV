'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { Header } from '@/components/header';
import { useNativeApp } from '@/components/native-player';
// 播放器（artplayer + hls.js）按需加载：拆出独立 chunk，不占首屏 First Load JS
import dynamic from 'next/dynamic';
const LivePlayer = dynamic(() => import('@/components/live-player').then((m) => m.LivePlayer), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-black">
      <Spinner size="lg" />
    </div>
  ),
});
import { LiveChannelList, type LiveChannelItem } from '@/components/live-channel-list';
import { LiveEpgPanel } from '@/components/live-epg-panel';
import { Spinner } from '@/components/states';
import { useAuth } from '@/components/auth';
import { allLiveSources, useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { SmartImage } from '@/components/smart-image';

/**
 * 直播页：左侧播放器 + 频道信息 + 节目单；右侧频道侧栏。
 * 状态由 URL 驱动（?url=&name=&group=&tvgId=&epg=），支持频道深链与刷新保持。
 * 换台路径：侧栏点击、全局 ↑↓ 键盘、播放器控制条上一台/下一台（全屏可用）。
 * 竖屏频道列表直接显示；横屏与桌面采用播放区、频道列表双栏。
 */
export default function LivePage() {
  return (
    <Suspense>
      <LiveContent />
    </Suspense>
  );
}

function LiveContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const native = useNativeApp();
  // 精确订阅所需字段：任何其他 store 变化（如测活写回）不应触发本组件重渲染
  const liveSelectedUrls = useAppStore((s) => s.liveSelectedUrls);
  const liveEnvSources = useAppStore((s) => s.liveEnvSources);
  const liveSubscriptions = useAppStore((s) => s.liveSubscriptions);
  const liveFavorites = useAppStore((s) => s.liveFavorites);
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);
  const { verified } = useAuth();
  const [logoFailed, setLogoFailed] = useState(false);
  /** 侧栏上报的筛选排序结果（键盘换台沿此列表顺序）；ref 存储，不触发重渲染 */
  const filteredRef = useRef<LiveChannelItem[]>([]);
  /** 当前频道镜像：selectChannel 内读取最近一次播放的频道，用于记录"上一个频道" */
  const currentChannelRef = useRef<LiveChannelItem | undefined>(undefined);
  /** 上一个频道：退格键/按钮一键切回（电视遥控器 back 键习惯） */
  const lastChannelRef = useRef<LiveChannelItem | null>(null);

  // 仅聚合已启用的直播源（设置 → 直播源中的勾选状态）
  const sources = useMemo(() => {
    const selected = new Set(liveSelectedUrls);
    return allLiveSources({ liveEnvSources, liveSubscriptions }).filter((s) => selected.has(s.url));
  }, [liveSelectedUrls, liveEnvSources, liveSubscriptions]);

  // 聚合全部直播源的 M3U 解析结果（单源失败不影响整体）
  const playlistsQuery = useQuery({
    queryKey: ['livePlaylists', sources.map((s) => s.url).join('|')],
    queryFn: async () => {
      const results = await Promise.allSettled(sources.map((s) => api.livePlaylist(s.url)));
      return sources.map((source, i) => ({ source, result: results[i] }));
    },
    enabled: verified && sources.length > 0,
    staleTime: 10 * 60_000,
  });

  const { channels, groups, failedCount } = useMemo(() => {
    const list: LiveChannelItem[] = [];
    const seen = new Set<string>();
    let failed = 0;
    for (const { source, result } of playlistsQuery.data ?? []) {
      if (result.status !== 'fulfilled') {
        failed++;
        continue;
      }
      for (const c of result.value.channels) {
        if (seen.has(c.url)) continue;
        seen.add(c.url);
        list.push({ ...c, epg: source.epg, sourceUrl: source.url });
      }
    }
    const groups = [...new Set(list.map((c) => c.group).filter((g): g is string => Boolean(g)))].sort(
      (a, b) => a.localeCompare(b, 'zh')
    );
    return { channels: list, groups, failedCount: failed };
  }, [playlistsQuery.data]);

  // 当前频道：优先取列表内完整对象（含台标），否则由 URL 参数重建
  const currentUrl = searchParams.get('url') || '';
  const currentChannel = useMemo(() => {
    const found = channels.find((c) => c.url === currentUrl);
    if (found) return found;
    if (!currentUrl) return undefined;
    return {
      id: searchParams.get('tvgId') || currentUrl,
      url: currentUrl,
      name: searchParams.get('name') || '未知频道',
      group: searchParams.get('group') || undefined,
      tvgId: searchParams.get('tvgId') || undefined,
      epg: searchParams.get('epg') || undefined,
    } as LiveChannelItem;
  }, [channels, currentUrl, searchParams]);

  useEffect(() => {
    setLogoFailed(false);
  }, [currentChannel?.url]);
  useEffect(() => {
    currentChannelRef.current = currentChannel;
  }, [currentChannel]);

  const selectChannel = useCallback(
    (c: LiveChannelItem) => {
      const cur = currentChannelRef.current;
      if (cur && cur.url !== c.url) lastChannelRef.current = cur;
      const sp = new URLSearchParams({ url: c.url, name: c.name });
      if (c.group) sp.set('group', c.group);
      if (c.tvgId) sp.set('tvgId', c.tvgId);
      if (c.epg) sp.set('epg', c.epg);
      router.replace(`/live?${sp.toString()}`, { scroll: false });
      useAppStore.getState().addLiveRecent({
        url: c.url,
        name: c.name,
        logo: c.logo,
        group: c.group,
        tvgId: c.tvgId,
        epg: c.epg,
        sourceUrl: c.sourceUrl,
      });
    },
    [router]
  );

  const handleFilteredChange = useCallback((list: LiveChannelItem[]) => {
    filteredRef.current = list;
  }, []);

  /** 沿侧栏当前筛选排序的列表顺序切上一台/下一台（循环） */
  const switchChannelByOffset = useCallback(
    (delta: 1 | -1) => {
      const list = filteredRef.current;
      if (list.length === 0) return;
      const nowUrl = new URLSearchParams(window.location.search).get('url') || '';
      const idx = list.findIndex((c) => c.url === nowUrl);
      const next =
        idx === -1 ? (delta === 1 ? 0 : list.length - 1) : (idx + delta + list.length) % list.length;
      selectChannel(list[next]);
    },
    [selectChannel]
  );

  const goPrevChannel = useCallback(() => switchChannelByOffset(-1), [switchChannelByOffset]);
  const goNextChannel = useCallback(() => switchChannelByOffset(1), [switchChannelByOffset]);

  /** 切回上一个频道（Backspace / 信息条按钮） */
  const backToPrevChannel = useCallback(() => {
    const prev = lastChannelRef.current;
    if (!prev) return;
    lastChannelRef.current = null;
    selectChannel(prev);
  }, [selectChannel]);

  // 全局键盘：↑↓ 直接切台，Backspace 切回上一个频道。
  // 输入框/列表光标导航场景让位（列表聚焦时由列表内 ↑↓ 管理光标）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isChannelKey = e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Backspace';
      if (!isChannelKey) return;
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        if (target.isContentEditable) return;
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (target.closest('[data-channel-list]')) return;
      }
      e.preventDefault();
      if (e.key === 'Backspace') backToPrevChannel();
      else switchChannelByOffset(e.key === 'ArrowDown' ? 1 : -1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [switchChannelByOffset, backToPrevChannel]);

  const handleSelect = useCallback(
    (c: LiveChannelItem) => {
      selectChannel(c);
    },
    [selectChannel]
  );

  if (!verified) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-faint text-sm">等待访问验证...</p>
        </div>
      </div>
    );
  }

  const logo = currentChannel?.logo;
  const isFavorite = currentChannel ? liveFavorites.includes(currentChannel.url) : false;

  return (
    <div className={cn("live-root min-h-screen flex flex-col", native && "live-native")}>
      <Header />
      <main className="live-page flex-1 max-w-7xl w-full mx-auto px-3 py-3 sm:px-4 sm:py-4">
        <div className="live-heading flex items-center justify-between gap-3 mb-3">
          <h1 className="text-lg font-semibold text-content">直播</h1>
          <span className="text-xs text-faint">{channels.length > 0 ? `${channels.length} 个频道` : '选择频道，开始观看'}</span>
        </div>
        <div className="live-layout">
          <section className="live-viewing min-w-0" aria-label="直播播放区">
            {currentUrl ? (
              <>
                <div className="live-video aspect-video bg-black rounded-xl overflow-hidden">
                  <LivePlayer url={currentUrl} title={currentChannel?.name || '直播'} onPrevChannel={goPrevChannel} onNextChannel={goNextChannel} />
                </div>
                {currentChannel && (
                  <div className="bg-surface-raised border border-line rounded-xl p-2 mt-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 shrink-0 rounded-lg bg-chip flex items-center justify-center overflow-hidden">
                        {logo && !logoFailed ? (
                          <SmartImage url={logo} mode={imageProxyMode} customProxy={customImageProxy} alt="" className="w-full h-full object-contain" onExhausted={() => setLogoFailed(true)} />
                        ) : <span className="text-sm text-faint">{currentChannel.name.slice(0, 1)}</span>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h2 className="text-sm font-semibold text-content truncate">{currentChannel.name}</h2>
                        <p className="text-xs text-faint mt-1 flex items-center gap-2"><span className="live-dot shrink-0" />直播{currentChannel.group ? ` · ${currentChannel.group}` : ''}</p>
                      </div>
                      <button className={cn('min-h-11 px-3 rounded-lg text-sm shrink-0 transition-colors', isFavorite ? 'text-warning bg-warning/10' : 'text-muted bg-chip hover:bg-hover')} aria-pressed={isFavorite} onClick={() => useAppStore.getState().toggleLiveFavorite(currentChannel.url)}>
                        {isFavorite ? '已收藏' : '收藏'}
                      </button>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <button className="min-h-11 px-3 rounded-lg bg-chip text-sm text-content hover:bg-hover disabled:opacity-40" onClick={goPrevChannel} disabled={channels.length === 0}>‹ 上一台</button>
                      <button className="min-h-11 px-3 rounded-lg bg-chip text-sm text-content hover:bg-hover disabled:opacity-40" onClick={goNextChannel} disabled={channels.length === 0}>下一台 ›</button>
                      <button className="min-h-11 px-2 text-xs text-muted hover:text-content disabled:opacity-40" onClick={backToPrevChannel} disabled={!lastChannelRef.current} title={lastChannelRef.current?.name}>返回上一频道</button>
                    </div>
                  </div>
                )}
                {currentChannel?.epg && currentChannel.tvgId && (
                  <section className="bg-surface-raised border border-line rounded-xl p-2 mt-3" aria-label="节目单">
                    <h2 className="text-sm font-semibold text-content mb-2.5">节目单</h2>
                    <LiveEpgPanel epgUrl={currentChannel.epg} tvgId={currentChannel.tvgId} />
                  </section>
                )}
              </>
            ) : (
              <div className="live-welcome rounded-xl border border-line bg-surface-raised px-5 py-6">
                <span className="text-xs text-accent font-medium">随时打开，轻松看台</span>
                <h2 className="text-xl font-semibold text-content mt-2">想看哪个频道？</h2>
                <p className="text-sm text-muted mt-2 leading-relaxed">
                  {sources.length === 0
                    ? '在设置中启用直播源，即可开始观看。'
                    : playlistsQuery.isLoading ? '正在加载频道列表…' : '从频道列表点选播放，也可以收藏常看的频道。'}
                </p>
                {sources.length === 0 && <button className="btn-primary mt-4" onClick={() => router.push('/settings')}>前往设置</button>}
              </div>
            )}
          </section>
          <aside className="live-channels bg-surface-raised border border-line rounded-xl flex flex-col overflow-hidden min-w-0" aria-label="频道列表">
            {playlistsQuery.isLoading && channels.length === 0 ? (
              <div className="flex-1 flex items-center justify-center gap-2 text-sm text-muted"><Spinner size="sm" />正在加载频道…</div>
            ) : (
              <LiveChannelList channels={channels} groups={groups} currentUrl={currentUrl} onSelect={handleSelect} onFilteredChange={handleFilteredChange} />
            )}
            {failedCount > 0 && (
              <div className="px-3 py-2 border-t border-line flex items-center justify-between gap-2 text-xs text-muted shrink-0" role="status">
                <span>{failedCount} 个直播源暂时无法加载</span>
                <button className="min-h-9 px-2 text-accent" disabled={playlistsQuery.isFetching} onClick={() => void playlistsQuery.refetch()}>{playlistsQuery.isFetching ? '重试中…' : '重试'}</button>
              </div>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}

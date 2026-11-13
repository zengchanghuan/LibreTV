'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { correctVideoDetail, sourceContentIssue } from '@/lib/source-content-corrections';
import { SourceContentWarning } from '@/components/source-content-warning';
// 播放器（artplayer + hls.js）按需加载：拆出独立 chunk，不占首屏 First Load JS
const PlayerShell = dynamic(() => import('@/components/player-shell').then((m) => m.PlayerShell), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center">
      <Spinner size="lg" />
    </div>
  ),
});
import { EmptyState, LoadingState, Spinner } from '@/components/states';
import { SwitchSourceModal } from '@/components/switch-source';
import { enqueueDownload } from '@/components/download-manager';
import { Icon } from '@/components/icon';
import { useAuth } from '@/components/auth';
import { FamilyButton, useFamily } from '@/components/family';
import { NativePlayerPanel, useNativeApp, useLegacyNativeWatchHeader } from '@/components/native-player';
import { nativePost } from '@/lib/native-player';
import { WatchMoreSheet } from '@/components/watch-more-sheet';
import { resolveSource, useAppStore } from '@/lib/store';
import {
  clearProgress,
  progressKeyOf,
  saveProgress,
  updateHistoryProgress,
  upsertHistory,
  db,
} from '@/lib/db';
import { cn } from '@/lib/utils';
import { RelatedVideos } from '@/components/related-videos';
import { VideoInfoPanel, videoInfoSummary } from '@/components/video-info-panel';
import { PwaUpdateBanner } from '@/components/pwa';
import { WatchTelemetry } from '@/components/watch-telemetry';
import { PlayerAutoNext } from '@/lib/player-auto-next';

/**
 * 播放页（唯一入口，替代旧版 watch.html → player.html 跳转链）。
 * 状态全部由 URL 驱动：/watch?source=xx&id=..&index=..&title=..
 * 集数列表由服务端详情接口获取；进度与历史走 IndexedDB。
 */
export default function WatchPage() {
  return (
    <Suspense>
      <WatchRoute />
    </Suspense>
  );
}

function WatchRoute() {
  const params = useSearchParams();
  // A related-film navigation must cancel the previous film's timers and player state.
  // Episode changes retain the same component so normal episode switching stays seamless.
  const key = JSON.stringify([params.get('source'), params.get('sourceUrl'), params.get('id') || params.get('url')]);
  return <WatchContent key={key} />;
}

function WatchContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const store = useAppStore();
  const { verified } = useAuth();
  const { ready: historyReady, open: openFamily } = useFamily();
  const nativeApp = useNativeApp();
  const legacyNativeHeader = useLegacyNativeWatchHeader();
  const [moreOpen, setMoreOpen] = useState(false);
  const closeMore = useCallback(() => setMoreOpen(false), []);
  useEffect(() => {
    if (!nativeApp) return;
    const enter = () => { nativePost({ type: 'watchLayout', enabled: true }); };
    enter();
    window.addEventListener('libretv:native-ready', enter);
    return () => { window.removeEventListener('libretv:native-ready', enter); nativePost({ type: 'watchLayout', enabled: false }); };
  }, [nativeApp]);

  const sourceKey = searchParams.get('source') || '';
  const vodId = searchParams.get('id') || '';
  const directUrl = searchParams.get('url') || '';
  const titleParam = searchParams.get('title') || '';
  const indexParam = parseInt(searchParams.get('index') || '0', 10) || 0;

  const [reversed, setReversed] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);
  const latestPosition = useRef(0);

  const source = resolveSource(store, sourceKey, {
    url: searchParams.get('sourceUrl') || undefined,
    detail: searchParams.get('detail') || undefined,
  });

  // 详情查询：无 id（纯直连链接分享）时跳过
  const detailQuery = useQuery({
    queryKey: ['detail', sourceKey, vodId, source?.url],
    queryFn: ({ signal }) => api.detail(vodId, source!, signal),
    enabled: Boolean(source && vodId && verified),
    staleTime: 5 * 60_000,
  });

  // Reapply the same rule to old query-cache entries and direct watch links.
  const safeDetail = useMemo(() => detailQuery.data
    ? correctVideoDetail(detailQuery.data, source?.url, vodId) : undefined,
  [detailQuery.data, source?.url, vodId]);
  const contentIssue = safeDetail?.videoInfo.contentIssue || sourceContentIssue(source?.url, vodId);

  const episodes = useMemo(() => safeDetail?.episodes ?? [], [safeDetail]);
  const multipleEpisodes = episodes.length > 1;
  const videoTitle = titleParam || safeDetail?.videoInfo?.title || '未知视频';

  // 当前播放地址：优先取剧集列表中的当前集，其次直连 URL 参数
  const currentUrl = useMemo(() => {
    if (episodes.length > 0) {
      const idx = Math.min(Math.max(indexParam, 0), episodes.length - 1);
      return episodes[idx] || directUrl;
    }
    return directUrl;
  }, [episodes, indexParam, directUrl]);

  const currentIndex = useMemo(() => {
    if (episodes.length > 0) return Math.min(Math.max(indexParam, 0), episodes.length - 1);
    return indexParam;
  }, [episodes, indexParam]);

  const autoNext = useMemo(() => new PlayerAutoNext(), []);
  // A queued transition belongs only to this episode and autoplay preference.
  useEffect(() => {
    autoNext.cancel();
    return () => autoNext.cancel();
  }, [autoNext, currentIndex, currentUrl, episodes.length, store.autoplayNext]);

  const goEpisode = useCallback(
    (index: number) => {
      autoNext.cancel();
      const sp = new URLSearchParams(searchParams.toString());
      sp.set('index', String(index));
      sp.set('url', episodes[index] || directUrl);
      sp.delete('position');
      router.replace(`/watch?${sp.toString()}`, { scroll: false });
    },
    [autoNext, router, searchParams, episodes, directUrl]
  );

  const setAutoplayNext = (enabled: boolean) => {
    autoNext.cancel();
    store.updateSettings({ autoplayNext: enabled });
  };

  // 进度恢复优先级：URL position 参数 > IndexedDB 记录
  const getRestorePosition = useCallback(async () => {
    const urlPos = parseInt(searchParams.get('position') || '0', 10) || 0;
    if (urlPos > 0) { latestPosition.current = urlPos; return urlPos; }
    if (!vodId) return 0;
    const entry = await db.progress.get(progressKeyOf(sourceKey, vodId, currentIndex));
    const position = entry?.position ?? 0;
    latestPosition.current = position;
    return position;
  }, [searchParams, sourceKey, vodId, currentIndex]);

  // 写入观看历史（进入页面即记录，进度后续增量更新）
  useEffect(() => {
    if (!verified || !historyReady || !sourceKey || !currentUrl) return;
    const timer = setTimeout(() => {
      upsertHistory({
        sourceKey,
        sourceUrl: source?.url,
        vodId: vodId || currentUrl,
        title: videoTitle,
        pic: safeDetail?.videoInfo?.cover,
        episodeIndex: currentIndex,
        totalEpisodes: episodes.length,
        playbackPosition: 0,
        duration: 0,
        timestamp: Date.now(),
      }).catch(() => {});
    }, 2000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verified, historyReady, sourceKey, vodId, currentIndex, videoTitle, currentUrl]);

  // 播放中与暂停时的进度落盘逻辑一致，共用同一回调
  const handleProgress = useCallback(
    (position: number, duration: number) => {
      if (vodId) {
        saveProgress(sourceKey, vodId, currentIndex, position, duration).catch(() => {});
        updateHistoryProgress(sourceKey, vodId || currentUrl, position, duration, currentIndex).catch(() => {});
      }
    },
    [sourceKey, vodId, currentIndex, currentUrl]
  );

  const handleEnded = useCallback(() => {
    if (vodId) clearProgress(sourceKey, vodId, currentIndex).catch(() => {});
    autoNext.schedule({ enabled: store.autoplayNext, index: currentIndex, count: episodes.length, onEpisode: goEpisode });
  }, [autoNext, store.autoplayNext, currentIndex, episodes.length, goEpisode, sourceKey, vodId]);

  // Alt+←/→ 集数切换快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      if (e.key === 'ArrowLeft' && currentIndex > 0) {
        e.preventDefault();
        goEpisode(currentIndex - 1);
      } else if (e.key === 'ArrowRight' && currentIndex < episodes.length - 1) {
        e.preventDefault();
        goEpisode(currentIndex + 1);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [currentIndex, episodes.length, goEpisode]);

  const orderedEpisodes = reversed ? [...episodes].map((_, i) => episodes.length - 1 - i) : episodes.map((_, i) => i);
  const downloadUnavailable = !currentUrl || currentUrl.startsWith('/api/site-playback?');
  const downloadCurrent = () => {
    if (downloadUnavailable) return;
    setMoreOpen(false);
    enqueueDownload({ url: currentUrl, title: `${videoTitle}${multipleEpisodes ? ` 第${currentIndex + 1}集` : ''}`, format: 'MP4' });
  };

  if (!verified || !historyReady) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-faint text-sm">{verified ? '正在同步观看进度...' : '等待访问验证...'}</p>
      </div>
    );
  }

  if (!source) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <h1 className="text-content font-medium mb-2">点播源不存在</h1>
          <p className="text-sm text-muted mb-4">
            该视频来自点播源「{sourceKey}」，但它可能已被删除。请在设置中重新添加后重试。
          </p>
          <Link href="/" className="btn-primary">返回首页</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="watch-page min-h-screen flex flex-col">
      <WatchTelemetry sourceKey={source.key} vodId={vodId} episode={currentIndex} enabled={verified && historyReady} />
      <header className="sticky top-0 z-40 bg-surface/90 backdrop-blur border-b border-line">
        <PwaUpdateBanner />
        {!legacyNativeHeader && <div className="grid min-h-14 grid-cols-[44px_1fr_44px] items-center px-4 sm:hidden">
          <BackButton />
          <span className="text-center text-sm font-medium">影片详情</span>
          <button className="btn-ghost !min-h-11 !min-w-11 !p-2" aria-label="更多操作" onClick={() => setMoreOpen(true)}><Icon name="more" /></button>
        </div>}
        <div className={cn('max-w-7xl mx-auto px-4 min-h-14 py-2 items-center gap-3', legacyNativeHeader ? 'hidden' : 'hidden sm:flex')}>
          <BackButton />
          <HomeButton />
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-medium text-content truncate">{videoTitle}</h1>
            <p className="text-xs text-faint">
              {source.name}
              {multipleEpisodes && ` · 第 ${currentIndex + 1}/${episodes.length} 集`}
            </p>
          </div>
          <div className="ml-auto w-full sm:w-auto flex justify-end items-center gap-2">
            <FamilyButton />
            <button
              className="btn-ghost btn-sm"
              disabled={downloadUnavailable}
              title={currentUrl.startsWith('/api/site-playback?') ? '该网站暂不支持站内下载' : undefined}
              onClick={downloadCurrent}
            >
              {multipleEpisodes ? '下载本集' : '下载影片'}
            </button>
            <button className="btn-ghost btn-sm" onClick={() => setSwitchOpen(true)}>
              切换资源
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-5 pt-5 pb-[max(24px,env(safe-area-inset-bottom))] sm:px-4 sm:py-4">
        <SourceContentWarning issue={contentIssue} />
        <div className={cn('mb-6', !legacyNativeHeader && 'sm:hidden')}>
          <div className="flex items-start justify-between gap-3"><h1 className="text-2xl font-semibold leading-tight tracking-tight text-content">{videoTitle}</h1>
            {legacyNativeHeader && <button className="btn-ghost -mr-2 !min-h-11 !min-w-11 !p-2" aria-label="更多操作" onClick={() => setMoreOpen(true)}><Icon name="more" /></button>}
          </div>
          {videoInfoSummary(safeDetail?.videoInfo) && <p className="mt-2 text-xs leading-relaxed text-muted">{videoInfoSummary(safeDetail?.videoInfo)}</p>}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">
          <div>
            <div className={cn(nativeApp && currentUrl ? '' : 'aspect-video bg-black rounded-xl overflow-hidden')}>
              {currentUrl ? (
                nativeApp ? <NativePlayerPanel
                  key={`${sourceKey}:${vodId}`} title={videoTitle} sourceKey={sourceKey} sourceUrl={source.url}
                  vodId={vodId || currentUrl} episodes={episodes.length ? episodes : [currentUrl]} index={episodes.length ? currentIndex : 0}
                  ready={!vodId || detailQuery.isSuccess || detailQuery.isError}
                  autoplayNext={multipleEpisodes && store.autoplayNext} getPosition={getRestorePosition} onEpisode={goEpisode}
                  onSleep={() => setAutoplayNext(false)} onProgress={position => { latestPosition.current = position; }}
                /> : <PlayerShell
                  url={currentUrl}
                  qualitySource={source.url}
                  title={videoTitle}
                  adFilter={store.adFilter}
                  autoplayNext={multipleEpisodes && store.autoplayNext}
                  episodeCount={episodes.length}
                  episodeIndex={currentIndex}
                  onEpisode={goEpisode}
                  onSleep={() => setAutoplayNext(false)}
                  episodeKey={`${sourceKey}:${vodId}:${currentIndex}`}
                  nextUrl={currentIndex + 1 < episodes.length ? episodes[currentIndex + 1] : undefined}
                  nextEpisodeKey={currentIndex + 1 < episodes.length ? `${sourceKey}:${vodId}:${currentIndex + 1}` : undefined}
                  getRestorePosition={getRestorePosition}
                  onTimeUpdate={(position, duration) => { latestPosition.current = position; handleProgress(position, duration); }}
                  onPause={(position, duration) => { latestPosition.current = position; handleProgress(position, duration); }}
                  onEnded={handleEnded}
                  onRequestSwitchSource={() => setSwitchOpen(true)}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  {detailQuery.isLoading ? (
                    <Spinner size="lg" />
                  ) : (
                    <p className="text-faint text-sm">
                      {detailQuery.isError ? '视频加载失败，请尝试其他资源' : '无可用播放地址'}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className={cn('mt-4 flex items-center justify-between gap-3 border-b border-line py-4', !legacyNativeHeader && 'sm:hidden')}>
              <div className="min-w-0"><p className="mb-1 text-xs text-muted">当前资源</p><p className="truncate text-sm font-medium">{source.name}</p></div>
              <button className="btn-ghost shrink-0 !min-h-11 !rounded-xl !px-4 text-accent" onClick={() => setSwitchOpen(true)}><Icon name="refresh" className="h-4 w-4" />换源</button>
            </div>

            {/* Single-film pages have no episode navigation or auto-next setting. */}
            {multipleEpisodes && <div className="flex flex-wrap items-center gap-2 mt-3">
              {nativeApp ? <>
                <button
                  className="btn-ghost btn-sm !min-h-11"
                  disabled={currentIndex <= 0}
                  onClick={() => goEpisode(currentIndex - 1)}
                >
                  上一集
                </button>
                <button
                  className="btn-ghost btn-sm !min-h-11"
                  disabled={episodes.length === 0 || currentIndex >= episodes.length - 1}
                  onClick={() => goEpisode(currentIndex + 1)}
                >
                  下一集
                </button>
              </> : <span className="text-xs text-muted">第 {currentIndex + 1} / {episodes.length} 集</span>}
              <label className="flex min-h-11 items-center gap-2 text-xs text-muted ml-auto cursor-pointer">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[rgb(var(--c-accent))]"
                  checked={store.autoplayNext}
                  onChange={(e) => setAutoplayNext(e.target.checked)}
                />
                自动连播
              </label>
            </div>}
          </div>

          {/* 剧集侧栏 */}
          <aside className="min-w-0 h-fit sm:bg-surface-raised sm:rounded-xl sm:p-4">
            {multipleEpisodes && <><div className="flex items-center justify-between gap-2 mb-2.5">
              <h2 className="text-sm font-semibold text-content">
                选集 <span className="ml-1 font-normal text-muted">{currentIndex + 1} / {episodes.length}</span>
              </h2>
              {/* 排列开关紧贴它所作用的列表：放在这里才看得出它管的是这一栏的顺序 */}
              {episodes.length > 1 && (
                <button
                  className="btn-ghost btn-sm shrink-0"
                  onClick={() => setReversed((v) => !v)}
                  aria-label={reversed ? '切换为正序排列' : '切换为倒序排列'}
                  title="调整剧集列表的排列顺序"
                >
                  <Icon
                    name="arrowDown"
                    className={cn('w-3.5 h-3.5 transition-transform', reversed && 'rotate-180')}
                  />
                  {reversed ? '正序排列' : '倒序排列'}
                </button>
              )}
            </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(44px,1fr))] lg:grid-cols-4 gap-2 max-h-64 overflow-y-auto scrollbar-thin pr-1">
                {orderedEpisodes.map((realIndex) => (
                  <EpisodeButton
                    key={realIndex}
                    index={realIndex}
                    active={realIndex === currentIndex}
                    onClick={() => goEpisode(realIndex)}
                  />
                ))}
              </div></>}
            {detailQuery.isLoading && <LoadingState label="正在读取影片资料…" />}
            {detailQuery.isError && <EmptyState variant="plain" title="暂未获取到影片资料" />}
            <VideoInfoPanel info={safeDetail?.videoInfo} compactOnMobile />
            <details className="hidden md:block text-xs text-muted mt-4 border-t border-line pt-3 leading-relaxed">
              <summary className="cursor-pointer min-h-8">播放快捷键</summary>
              <p className="pt-2">空格 播放/暂停 · ←/→ 快退/快进 5s · ↑/↓ 音量 · F 全屏 · Alt+←/→ 切换集数</p>
            </details>
          </aside>
        </div>
        <RelatedVideos
          source={source}
          vodId={vodId}
          info={safeDetail?.videoInfo || { title: videoTitle, sourceKey: source.key, sourceName: source.name }}
          ready={detailQuery.isSuccess || detailQuery.isError}
          section={searchParams.get('section') === 'hd' ? 'hd' : undefined}
        />
      </main>

      {moreOpen && <WatchMoreSheet multipleEpisodes={multipleEpisodes} downloadUnavailable={downloadUnavailable} onClose={closeMore}
        onDownload={downloadCurrent} onSync={() => { setMoreOpen(false); openFamily(); }} />}

      {switchOpen && (
        <SwitchSourceModal
          currentTitle={videoTitle}
          currentSourceKey={sourceKey}
          currentVodId={vodId}
          currentIndex={currentIndex}
          getCurrentPosition={() => latestPosition.current}
          onClose={() => setSwitchOpen(false)}
        />
      )}
    </div>
  );
}

/** 集数按钮：激活时自动滚动进可视区（长剧列表） */
function EpisodeButton({ index, active, onClick }: { index: number; active: boolean; onClick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <button
      ref={ref}
      className={cn('btn btn-sm !min-h-11 !px-1 !rounded-xl', active ? 'episode-active' : 'btn-ghost')}
      onClick={onClick}
    >
      {index + 1}
    </button>
  );
}

function BackButton() {
  const router = useRouter();
  return (
    <button
      className="min-h-11 min-w-11 p-2 -ml-2 rounded-md text-muted hover:text-content hover:bg-hover transition-colors"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push('/');
      }}
      aria-label="返回"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
      </svg>
    </button>
  );
}

/** 首页按钮：直达首页，避免从外链进入时逐级 back */
function HomeButton() {
  return (
    <Link
      href="/"
      className="p-2 rounded-md text-muted hover:text-content hover:bg-hover transition-colors"
      aria-label="回首页"
      title="回首页"
    >
      <Icon name="home" className="w-5 h-5" />
    </Link>
  );
}

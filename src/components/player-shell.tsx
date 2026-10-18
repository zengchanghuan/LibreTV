'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Artplayer from 'artplayer';
import Hls, { type HlsConfig, type FragmentLoaderContext } from 'hls.js';

import { PlaybackTracker } from '@/lib/playback-quality';
import { usePlaybackQuality } from '@/lib/playback-quality-store';
import { PlaybackRecovery, describeHlsError } from '@/lib/playback-recovery';
import { playbackLoaders, type PlaybackFragmentObserver } from '@/lib/hls-loader';
import { ForegroundPrefetcher } from '@/lib/foreground-prefetch';
import { PlaybackFragmentCache } from '@/lib/playback-fragment-cache';
import { hasPlaybackHeadroom, hlsEngine, isAppleMobile } from '@/lib/media-support';
import { PlaybackTools } from './playback-tools';
import {
  getVideoPrefetcher,
  getNextEpisodePrefetcher,
} from '@/lib/video-prefetcher';
import { loadCacheSettings } from '@/lib/video-cache';
import { formatTime } from '@/lib/utils';

/**
 * 播放器外壳：ArtPlayer + hls.js（旧版 player.js 的 React 化）。
 * 保留：广告分片过滤、自动连播回调、进度回调、快捷键、移动端长按倍速、错误恢复。
 * 移除：DOM 手工操作、watch.html 跳转链、localStorage 状态总线。
 *
 * 关键设计：ArtPlayer 实例只在挂载时创建一次，换集（url 变化）只「切换 HLS 源」
 * 而不销毁重建。否则在「网页全屏（页面全屏）」下整实例重建会丢失全屏上下文、
 * 重建 <video> 元素，触发「黑屏有声」的渲染竞态。
 */

interface PlayerShellProps {
  url: string;
  qualitySource?: string;
  title: string;
  adFilter: boolean;
  autoplayNext: boolean;
  /** 剧集标识 `${source}:${vodId}:${episodeIndex}`（片段缓存按集淘汰的分组键） */
  episodeKey?: string;
  /** Reserved for callers; automatic next-episode downloads are disabled. */
  nextUrl?: string;
  nextEpisodeKey?: string;
  /** 进度恢复：优先 URL position，其次查询该回调（返回 0 表示无记录） */
  getRestorePosition?: () => number | Promise<number>;
  onTimeUpdate?: (position: number, duration: number) => void;
  onEnded?: () => void;
  onPause?: (position: number, duration: number) => void;
  /** 恢复策略判源不可用（重试耗尽/格式硬失败）时回调：父级弹出换源面板 */
  onRequestSwitchSource?: (reason: string) => void;
  episodeCount?: number;
  episodeIndex?: number;
  onEpisode?: (index: number) => void;
  onSleep?: () => void;
}

export function PlayerShell({
  url,
  qualitySource,
  title,
  adFilter,
  autoplayNext,
  episodeKey,
  getRestorePosition,
  onTimeUpdate,
  onEnded,
  onPause,
  onRequestSwitchSource,
  episodeCount = 0,
  episodeIndex = 0,
  onEpisode,
  onSleep,
}: PlayerShellProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const artRef = useRef<any>(null);
  const hlsRef = useRef<Hls | null>(null);
  const nativeMode = useRef(false);
  const nativeRetryPosition = useRef(0);
  const sleeping = useRef(false);
  const [player, setPlayer] = useState<Artplayer | null>(null);
  const mediaTypeRef = useRef<'m3u8' | 'mp4'>('m3u8');
  const resolveControllerRef = useRef<AbortController | null>(null);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  // 起播前的品牌占位图（沿用旧版 nomedia 素材），实际开始播放后隐藏
  const [showPoster, setShowPoster] = useState(true);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 始终持有最新 props/回调，避免重建播放器
  const propsRef = useRef({
    url, qualitySource, title, adFilter, autoplayNext, episodeKey,
    getRestorePosition, onTimeUpdate, onEnded, onPause, onRequestSwitchSource,
  });
  propsRef.current = {
    url, qualitySource, title, adFilter, autoplayNext, episodeKey,
    getRestorePosition, onTimeUpdate, onEnded, onPause, onRequestSwitchSource,
  };
  const activePropsRef = useRef(propsRef.current);
  const changingMedia = useRef(false);

  // 跨集共享、每次换集重置的播放链路状态
  // 媒体健康度：音频轨可播不代表视频轨正常（「黑屏但有声」的假死态）。
  // 仅当有分片真正进入 MSE buffer 后才视为恢复，错误遮罩才能被清除。
  const mediaHealthyRef = useRef(true);
  const playbackStartedRef = useRef(false);
  // 起播阶段的 video 元素级错误允许自愈重试一次（重建 hls/MSE）
  const videoErrorRetryUsedRef = useRef(false);
  // 进度恢复每集只执行一次（MANIFEST_PARSED 可能因代理回退再次触发）
  const restoredRef = useRef(false);
  // setupHls 可能改走代理形式，video:error 重试要用最近一次的地址
  const currentMediaUrlRef = useRef(url);
  // 本集的恢复策略实例：跨直连/代理两级重建共享计数
  const recoveryRef = useRef<PlaybackRecovery | null>(null);
  // 自然播完标记，卸载时不回写进度（避免覆盖「已看完」记录）
  const endedRef = useRef(false);
  const qualityRef = useRef<{ source: string; tracker: PlaybackTracker; failed: boolean } | null>(null);
  const flushQuality = (failed = false) => {
    const q = qualityRef.current; if (!q || (failed && q.failed)) return;
    const delta = q.tracker.drain(performance.now(), failed);
    if (failed) q.failed = true;
    if (delta.startupMs !== undefined || delta.playedMs > 0 || delta.stalledMs > 0 || delta.failed)
      usePlaybackQuality.getState().record(q.source, delta);
  };
  const startQuality = () => {
    flushQuality();
    const source = propsRef.current.qualitySource;
    qualityRef.current = source ? { source, tracker: new PlaybackTracker(performance.now()), failed: false } : null;
    qualityRef.current?.tracker.visibility(performance.now(), document.hidden);
  };

  const showHint = (text: string) => {
    setHint(text);
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    hintTimerRef.current = setTimeout(() => setHint(''), 2500);
  };

  // A bounded HLS buffer owns all automatic downloads on the 4 Mbps link.
  const buildHlsConfig = (foreground: ForegroundPrefetcher, onFragment: PlaybackFragmentObserver): Partial<HlsConfig> => {
    const p = propsRef.current;
    const cacheSettings = loadCacheSettings();
    const cacheEnabled = cacheSettings.enabled && !!p.episodeKey;
    return {
      debug: false,
      enableWorker: true,
      backBufferLength: 90,
      maxBufferLength: cacheEnabled ? 60 : 30,
      maxMaxBufferLength: cacheEnabled ? 120 : 60,
      maxBufferSize: 30 * 1000 * 1000,
      maxBufferHole: 0.5,
      fragLoadingMaxRetry: 6,
      fragLoadingRetryDelay: 1000,
      manifestLoadingMaxRetry: 3,
      manifestLoadingRetryDelay: 1000,
      startLevel: -1,
      abrEwmaDefaultEstimate: 500_000,
      appendErrorMaxRetry: 5,
      // 组合 loader：广告过滤（blockAd 随设置）+ 片段缓存命中（cacheEnabled）
      ...playbackLoaders(Hls, p.adFilter, foreground, onFragment),
    };
  };

  // Retire any automatic prefetch left by a previous player instance.
  const yieldPrefetch = () => {
    for (const prefetcher of [getVideoPrefetcher(), getNextEpisodePrefetcher()]) {
      if (['running', 'parsing'].includes(prefetcher.getStats().state)) prefetcher.stop();
    }
  };
  const setupNativeHls = (video: HTMLVideoElement, mediaUrl: string) => {
    hlsRef.current?.destroy(); hlsRef.current = null;
    nativeMode.current = true;
    // Native media can use cross-origin URLs without JS CORS access.
    video.removeAttribute('crossorigin');
    currentMediaUrlRef.current = mediaUrl;
    video.src = mediaUrl; video.load();
    video.play().catch(() => showHint('点击播放按钮开始观看'));
    getVideoPrefetcher().stop(); getNextEpisodePrefetcher().stop();
  };

  /**
   * 初始化/切换 HLS。allowProxyFallback：直连致命网络错误（CORS/防盗链/分片被拒）时，
   * 自动改走同源 cookie 鉴权的 /api/proxy 重试一次。
   * 注意：不销毁 ArtPlayer，只销毁并重建 hls，从而保留网页全屏等播放器状态。
   */
  const setupHls = (video: HTMLVideoElement, mediaUrl: string, allowProxyFallback: boolean) => {
    hlsRef.current?.destroy();
    const engine = hlsEngine(Hls.isSupported(), video.canPlayType('application/vnd.apple.mpegurl'));
    if (engine === 'native') { setupNativeHls(video, mediaUrl); return; }
    if (engine === 'unsupported') { setError('当前浏览器不支持此视频格式，请更新系统或切换视频源'); return; }
    nativeMode.current = false;
    video.crossOrigin = 'anonymous';
    currentMediaUrlRef.current = mediaUrl;
    yieldPrefetch();
    const foreground = new ForegroundPrefetcher();
    const playbackCache = new PlaybackFragmentCache(propsRef.current.episodeKey);
    const hls: Hls = new Hls(buildHlsConfig(foreground, (response, stats, context) => {
      const { frag, part } = context as FragmentLoaderContext;
      if (!frag || !(response.data instanceof ArrayBuffer)) return;
      const details = hls.levels[frag.level]?.details;
      // Only complete VOD media fragments, never keys, init data, live or ranges.
      if (!details || details.live || part || frag.type !== 'main' ||
          typeof frag.sn !== 'number' || frag.byteRange.length) return;
      const index = details.fragments.findIndex(item => item === frag);
      if (index < 0) return;
      playbackCache.remember(context.url, response.data, index + 1,
        Math.max(1, stats.loading.end - stats.loading.start));
    }));
    hlsRef.current = hls;

    const clearForeground = () => foreground.seek(video.currentTime);
    // Register before HLS's media listeners so a seek clears old work first.
    video.addEventListener('seeking', clearForeground);
    hls.on(Hls.Events.DESTROYING, () => {
      video.removeEventListener('seeking', clearForeground);
      foreground.clear();
      playbackCache.dispose();
    });
    hls.on(Hls.Events.FRAG_LOADING, (_event, { frag }) => {
      const details = hls.levels[frag.level]?.details;
      const index = details?.fragments.findIndex(item => item === frag) ?? -1;
      const next = details && index >= 0 ? details.fragments[index + 1] : undefined;
      if (!details || details.live || frag.type !== 'main' || typeof frag.sn !== 'number' || frag.byteRange.length) {
        foreground.clear(); return;
      }
      const preloadNext = next && !next.byteRange.length && !hasPlaybackHeadroom(video) ? next : undefined;
      foreground.prepare(frag.url, preloadNext?.url, {
        start: frag.start, end: preloadNext ? preloadNext.start + preloadNext.duration : frag.start + frag.duration,
      });
    });

    hls.loadSource(mediaUrl);
    hls.attachMedia(video);

    hls.on(Hls.Events.MANIFEST_PARSED, async () => {
      recoveryRef.current?.markHealthy();
      // HLS 在 manifest 解析时尚未必有 duration；等 loadedmetadata 再恢复进度。
      // Wait for actual playback before starting background downloads.
      video.play().catch((err) => { if (err.name === 'NotAllowedError') qualityRef.current?.tracker.pause(performance.now()); });
    });
    // 播放链路恢复（FRAG_LOADED / MANIFEST_PARSED）：静默窗外清零连续失败计数
    hls.on(Hls.Events.FRAG_LOADED, () => recoveryRef.current?.markHealthy());
    // 分片真正进入 MSE buffer 才算媒体恢复：此时视频轨可渲染，错误态可解除
    hls.on(Hls.Events.FRAG_BUFFERED, () => {
      mediaHealthyRef.current = true;
    });

    hls.on(Hls.Events.ERROR, (_evt, data) => {
      if (!data.fatal) return;
      const recovery = recoveryRef.current;
      if (!recovery) return;
      const decision = recovery.onFatal(data.type, data.details);
      switch (decision.action) {
        case 'ignore':
          break;
        case 'retry': {
          // 前两次重试保留直连；达到退避阈值或清单级错误时升级为代理形式
          // （同源 cookie 鉴权，规避 CORS/防盗链/分片被拒）
          if (
            allowProxyFallback &&
            !mediaUrl.startsWith('/api/proxy') &&
            (decision.attempt >= 2 || data.details === 'manifestLoadError')
          ) {
            showHint('直连失败，改用代理重试...');
            setupHls(video, `/api/proxy?url=${encodeURIComponent(mediaUrl)}`, false);
            return;
          }
          showHint(`${decision.reason}（第 ${decision.attempt} 次）...`);
          recovery.schedule(decision.delayMs, () => hls.startLoad());
          break;
        }
        case 'recover-media': {
          showHint(`${decision.reason}（第 ${decision.attempt} 次）...`);
          if (decision.swapAudio) hls.swapAudioCodec?.();
          hls.recoverMediaError();
          break;
        }
        case 'switch-source': {
          if (video.canPlayType('application/vnd.apple.mpegurl')) {
            nativeRetryPosition.current = video.currentTime;
            showHint('正在切换系统兼容播放模式');
            setupNativeHls(video, mediaUrl);
            return;
          }
          // 覆盖播放开始后的场景：起播失败走 setError 遮罩；
          // 播放中失败走回调弹换源面板（父级未提供回调时同样 setError）
          flushQuality(true);
          const message = `${describeHlsError(data.type, data.details)}：${decision.reason}`;
          if (playbackStartedRef.current) {
            showHint(message);
            propsRef.current.onRequestSwitchSource?.(decision.reason);
          } else {
            setError(`视频加载失败，${message}，请尝试其他视频源`);
          }
          break;
        }
      }
    });
  };

  // Resolve site episode tokens only when selected. Abort stale resolutions on rapid episode changes.
  const setupMedia = async (video: HTMLVideoElement, targetUrl: string) => {
    changingMedia.current = true;
    // Save through the previous episode's callback before replacing it.
    if (video.duration > 0 && !endedRef.current) activePropsRef.current.onPause?.(video.currentTime, video.duration);
    activePropsRef.current = propsRef.current;
    endedRef.current = false;
    nativeRetryPosition.current = 0;
    resolveControllerRef.current?.abort();
    const controller = new AbortController();
    resolveControllerRef.current = controller;
    hlsRef.current?.destroy(); hlsRef.current = null;
    video.pause();
    video.removeAttribute('src');
    try {
      let mediaUrl = targetUrl;
      let type: 'm3u8' | 'mp4' = /\.mp4(?:\?|$)/i.test(targetUrl) ? 'mp4' : 'm3u8';
      if (targetUrl.startsWith('/api/site-playback?')) {
        showHint('正在解析播放线路...');
        const res = await fetch(targetUrl, { signal: controller.signal });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '播放解析失败');
        if (!/^https?:\/\//.test(data.url || '') || !['mp4', 'm3u8'].includes(data.type)) throw new Error('无效的播放地址');
        mediaUrl = data.url; type = data.type;
      }
      if (controller.signal.aborted) return;
      changingMedia.current = false;
      mediaTypeRef.current = type;
      nativeMode.current = type === 'mp4';
      currentMediaUrlRef.current = mediaUrl;
      if (type === 'mp4') {
        video.removeAttribute('crossorigin');
        video.src = mediaUrl;
        video.load();
        video.play().catch((err) => { if (err.name === 'NotAllowedError') qualityRef.current?.tracker.pause(performance.now()); });
      } else setupHls(video, mediaUrl, true);
    } catch (err) {
      if (!controller.signal.aborted) { changingMedia.current = false; flushQuality(true); setError(err instanceof Error ? err.message : '播放解析失败'); }
    }
  };

  /** 换集：重置每集状态并切换到新 HLS 源（不重建 ArtPlayer）。 */
  const loadEpisode = (targetUrl: string) => {
    if (!targetUrl) return;
    mediaHealthyRef.current = true;
    playbackStartedRef.current = false;
    videoErrorRetryUsedRef.current = false;
    restoredRef.current = false;
    recoveryRef.current?.dispose();
    recoveryRef.current = new PlaybackRecovery();
    // 换集时清掉上一集的预取窗口，避免带宽被旧集占用
    getVideoPrefetcher().stop();
    setError('');
    setShowPoster(true);
    const art = artRef.current;
    if (!art) return;
    startQuality();
    void setupMedia(art.video, targetUrl);
  };

  // —— 创建播放器（仅一次，挂载即创建） ——
  useEffect(() => {
    if (!containerRef.current || !propsRef.current.url) return;
    const initialUrl = propsRef.current.url;

    // 初始化每集状态
    mediaHealthyRef.current = true;
    playbackStartedRef.current = false;
    videoErrorRetryUsedRef.current = false;
    restoredRef.current = false;
    recoveryRef.current = new PlaybackRecovery();
    endedRef.current = false;

    let lastSave = 0;

    startQuality();
    const art = new Artplayer({
      container: containerRef.current,
      url: initialUrl,
      type: 'm3u8',
      volume: 0.8,
      autoplay: true,
      pip: true,
      autoMini: true,
      screenshot: true,
      setting: true,
      playbackRate: false, // The persistent speed selector lives in PlaybackTools.
      aspectRatio: true,
      fullscreen: !isAppleMobile(),
      fullscreenWeb: true,
      miniProgressBar: true,
      mutex: true,
      backdrop: true,
      playsInline: true,
      airplay: true,
      hotkey: false,
      theme: '#2563eb',
      lang: navigator.language.toLowerCase().startsWith('zh') ? 'zh-cn' : 'en',
      moreVideoAttr: { crossOrigin: 'anonymous', playsInline: true },
      customType: {
        m3u8: (video: HTMLVideoElement, mediaUrl: string) => {
          void setupMedia(video, mediaUrl);
        },
      },
    });
    artRef.current = art;
    setPlayer(art);
    art.on('video:loadedmetadata', async () => {
      if (nativeRetryPosition.current > 0) {
        art.currentTime = nativeRetryPosition.current;
        nativeRetryPosition.current = 0;
      }
      if (!restoredRef.current) {
        restoredRef.current = true;
        const media = currentMediaUrlRef.current;
        try {
          const saved = await activePropsRef.current.getRestorePosition?.() || 0;
          if (media === currentMediaUrlRef.current && saved > 10 && saved < art.duration - 2) {
            art.currentTime = saved;
            showHint(`已从 ${formatTime(saved)} 继续播放`);
          }
        } catch { /* ignore unavailable progress */ }
      }
      // ArtPlayer 运行时支持 title 选项（类型定义未覆盖），用于界面标题展示
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (art as any).title = propsRef.current.title;
      } catch { /* 忽略 */ }
    });

    art.on('video:play', () => {
      sleeping.current = false;
      qualityRef.current?.tracker.play(performance.now());
      yieldPrefetch();
    });
    art.on('video:ratechange', () => {
      if (!art.video.paused && !hasPlaybackHeadroom(art.video)) yieldPrefetch();
    });
    art.on('video:seeking', () => {
      qualityRef.current?.tracker.seek(performance.now(), true);
      yieldPrefetch();
    });
    art.on('video:seeked', () => qualityRef.current?.tracker.seek(performance.now(), false));
    art.on('video:playing', () => {
      if (art.video.videoWidth > 0) { qualityRef.current?.tracker.playing(performance.now()); flushQuality(); }
      playbackStartedRef.current = true;
      if (nativeMode.current) mediaHealthyRef.current = true;
      setShowPoster(false);
      // 仅在媒体真正恢复（有分片进入 buffer）后清错误遮罩：
      // 否则「视频轨挂了、音频轨先播出来」时会清掉遮罩，留下黑屏假死态
      if (mediaHealthyRef.current) setError('');
    });
    art.on('video:error', () => {
      mediaHealthyRef.current = false;
      if (nativeMode.current) {
        const target = currentMediaUrlRef.current;
        if (!target.startsWith('/api/proxy?')) {
          const position = art.currentTime || 0;
          nativeRetryPosition.current = position;
          currentMediaUrlRef.current = `/api/proxy?url=${encodeURIComponent(target)}`;
          art.video.src = currentMediaUrlRef.current;
          art.video.load();
          art.play().catch(() => showHint('点击播放按钮继续观看'));
        } else { flushQuality(true); setError('视频播放失败，请尝试其他视频源'); }
        return;
      }
      // 起播阶段的 video 元素级错误（MSE/解码偶发失败）：重建一次播放链路自愈，
      // 而不是直接钉死错误遮罩——重建后视频轨重新 append，黑屏有声即可解除
      if (!playbackStartedRef.current && !videoErrorRetryUsedRef.current) {
        videoErrorRetryUsedRef.current = true;
        showHint('播放异常，正在重试...');
        setupHls(art.video, currentMediaUrlRef.current, true);
        return;
      }
      if (art.video.canPlayType('application/vnd.apple.mpegurl')) {
        nativeRetryPosition.current = art.currentTime || 0;
        setupNativeHls(art.video, currentMediaUrlRef.current);
        return;
      }
      flushQuality(true);
      setError('视频播放失败，请尝试其他视频源');
    });
    art.on('video:timeupdate', () => {
      const now = Date.now();
      if (!art.video.paused && !hasPlaybackHeadroom(art.video)) yieldPrefetch();
      if (now - lastSave > 5000) {
        lastSave = now;
        if (!changingMedia.current && restoredRef.current) activePropsRef.current.onTimeUpdate?.(art.currentTime, art.duration);
      }
    });
    art.on('video:pause', () => {
      qualityRef.current?.tracker.pause(performance.now()); flushQuality();
      if (!changingMedia.current && restoredRef.current && !endedRef.current) activePropsRef.current.onPause?.(art.currentTime, art.duration);
      // HLS may fill its bounded forward buffer while paused; no whole-episode
      // or next-episode queue competes when the user resumes or seeks.
      yieldPrefetch();
    });
    art.on('video:waiting', () => {
      qualityRef.current?.tracker.waiting(performance.now());
      // Cancel both episodes' background traffic so the seek target loads first.
      yieldPrefetch();
    });
    art.on('video:playing', yieldPrefetch);
    art.on('video:ended', () => {
      qualityRef.current?.tracker.pause(performance.now()); flushQuality();
      endedRef.current = true;
      if (!sleeping.current) activePropsRef.current.onEnded?.();
    });

    // —— 键盘快捷键（旧版 hotkey:false + 自定义逻辑的移植） ——
    const shortcuts = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // 输入框或按钮获得焦点时不劫持按键：否则空格会吞掉按钮的默认激活
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.closest('button, .playback-tools-panel')) return;
      const current = artRef.current;
      if (!current) return;
      if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); return; } // 由父层处理集数切换
      if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); return; }
      switch (e.key) {
        case 'ArrowLeft':
          if (current.currentTime > 5) { current.currentTime -= 5; showHint('快退 5s'); e.preventDefault(); }
          break;
        case 'ArrowRight':
          if (current.duration - current.currentTime > 5) { current.currentTime += 5; showHint('快进 5s'); e.preventDefault(); }
          break;
        case 'ArrowUp':
          if (current.volume < 1) { current.volume = Math.min(1, current.volume + 0.1); showHint(`音量 ${Math.round(current.volume * 100)}%`); e.preventDefault(); }
          break;
        case 'ArrowDown':
          if (current.volume > 0) { current.volume = Math.max(0, current.volume - 0.1); showHint(`音量 ${Math.round(current.volume * 100)}%`); e.preventDefault(); }
          break;
        case ' ':
          current.toggle(); showHint('播放/暂停'); e.preventDefault();
          break;
        case 'f': case 'F':
          if (isAppleMobile()) current.fullscreenWeb = !current.fullscreenWeb;
          else current.fullscreen = !current.fullscreen;
          e.preventDefault();
          break;
      }
    };
    document.addEventListener('keydown', shortcuts);

    // —— 移动端长按 3 倍速 ——
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;
    let isLongPress = false;
    let originalRate = 1.0;
    const el = containerRef.current;

    const onTouchStart = (e: TouchEvent) => {
      if (art.video?.paused) return;
      // 已有触控在处理时忽略新手指：否则第二指会把 originalRate 捕获成 3.0，
      // 松手后倍速永久卡在 3x；旧定时器句柄也会被覆盖成无法清除的幽灵触发
      if (isLongPress || longPressTimer) return;
      // 控制栏 / 设置面板上的长按不触发倍速（按住进度条拖动、长按倍速菜单项会误触）
      if ((e.target as HTMLElement).closest?.('.art-controls, .art-settings, .playback-tools-panel')) return;
      originalRate = art.video.playbackRate;
      longPressTimer = setTimeout(() => {
        if (art.video?.paused) return;
        art.video.playbackRate = 3.0;
        isLongPress = true;
        showHint('3 倍速');
      }, 500);
    };
    const onTouchEnd = () => {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
      if (isLongPress) {
        art.video.playbackRate = originalRate;
        isLongPress = false;
        showHint(`${originalRate} 倍速`);
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (isLongPress) e.preventDefault();
    };
    // ArtPlayer 的 contextmenu 组件只在桌面端初始化（移动端构造函数里跳过 init），
    // 长按倍速因而会连带呼出系统原生菜单/气泡。播放器表面没有可用的原生菜单，统一抑制
    const onContextMenu = (e: Event) => e.preventDefault();
    el?.addEventListener('touchstart', onTouchStart, { passive: false });
    el?.addEventListener('touchend', onTouchEnd);
    el?.addEventListener('touchcancel', onTouchEnd);
    el?.addEventListener('touchmove', onTouchMove, { passive: false });
    el?.addEventListener('contextmenu', onContextMenu);

    // 卸载与页面隐藏时保存进度
    const qualityTimer = setInterval(() => flushQuality(), 15000);
    const saveOnHide = () => {
      qualityRef.current?.tracker.visibility(performance.now(), document.visibilityState === 'hidden');
      flushQuality();
      if (document.visibilityState === 'hidden') {
        if (!changingMedia.current && !endedRef.current) activePropsRef.current.onPause?.(art.currentTime, art.duration);
      }
    };
    document.addEventListener('visibilitychange', saveOnHide);

    return () => {
      clearInterval(qualityTimer); flushQuality(); qualityRef.current = null;
      // 卸载前刷一次最终进度，避免丢失最后几秒。
      // 已自然播完的集数不回写，避免覆盖 onEnded 里清除的「已看完」记录
      if (!endedRef.current) {
        try {
          if (!changingMedia.current) activePropsRef.current.onPause?.(art.currentTime, art.duration);
        } catch { /* 忽略 */ }
      }
      document.removeEventListener('keydown', shortcuts);
      document.removeEventListener('visibilitychange', saveOnHide);
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
      el?.removeEventListener('touchstart', onTouchStart);
      el?.removeEventListener('touchend', onTouchEnd);
      el?.removeEventListener('touchcancel', onTouchEnd);
      el?.removeEventListener('touchmove', onTouchMove);
      el?.removeEventListener('contextmenu', onContextMenu);
      resolveControllerRef.current?.abort();
      hlsRef.current?.destroy();
      hlsRef.current = null;
      recoveryRef.current?.dispose();
      getVideoPrefetcher().stop();
      getNextEpisodePrefetcher().stop();
      art.destroy();
      artRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // —— 换集：仅切换 HLS 源，不重建播放器（保留网页全屏等状态） ——
  const firstUrlRef = useRef(true);
  useEffect(() => {
    // 挂载时的首次由创建 effect 的 customType 触发，跳过避免重复加载
    if (firstUrlRef.current) { firstUrlRef.current = false; return; }
    loadEpisode(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // —— 广告过滤开关变化：重建 HLS loader（无需重建整个播放器） ——
  const firstAdFilterRef = useRef(true);
  useEffect(() => {
    if (firstAdFilterRef.current) { firstAdFilterRef.current = false; return; }
    if (artRef.current && hlsRef.current) {
      // 用当前实际媒体地址：代理回退生效时切广告过滤不应跳回直连形式
      loadEpisode(currentMediaUrlRef.current || propsRef.current.url);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adFilter]);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" style={{ WebkitTouchCallout: 'none' }} />
      {player && createPortal(<PlaybackTools player={player} count={episodeCount} index={episodeIndex} onEpisode={onEpisode} onSleep={() => {
        sleeping.current = true;
        getVideoPrefetcher().stop(); getNextEpisodePrefetcher().stop();
        onSleep?.();
      }} />, player.template.$player)}
      {showPoster && !error && (
        <div
          className="absolute inset-0 bg-black pointer-events-none"
          style={{
            backgroundImage: 'url(/player-poster.png)',
            backgroundSize: 'contain',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
          }}
        />
      )}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80">
          <p className="text-danger text-sm">{error}</p>
          <button className="btn-ghost text-xs" onClick={() => location.reload()}>
            重新加载
          </button>
        </div>
      )}
      {hint && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/70 text-white text-sm px-3 py-1.5 rounded-full pointer-events-none animate-fade-in">
          {hint}
        </div>
      )}
      {autoplayNext && !error && (
        <div className="absolute bottom-16 right-3 text-[10px] text-muted bg-black/50 px-2 py-0.5 rounded pointer-events-none">
          自动连播已开启
        </div>
      )}
    </div>
  );
}

'use client';
import { useEffect, useRef, useState } from 'react';
import { isNativeApp, nativePost, parseNativeProgress, scheduleNativeAutoOpen, type NativeSession } from '@/lib/native-player';
import { activeSyncId, db, recordNativeProgress } from '@/lib/db';
import { useAuth } from './auth';
import { useFamily } from './family';
import { Icon } from './icon';

export function useNativeApp() {
  const [native, setNative] = useState(false);
  useEffect(() => {
    const check = () => setNative(isNativeApp()); check();
    window.addEventListener('libretv:native-ready', check);
    return () => window.removeEventListener('libretv:native-ready', check);
  }, []);
  return native;
}

/** Older iOS installs still own their navigation bar; avoid drawing a second one. */
export function useLegacyNativeWatchHeader() {
  const [legacy, setLegacy] = useState(false);
  useEffect(() => {
    const check = () => {
      const bridge = window.__LIBRETV_NATIVE__;
      setLegacy(bridge?.platform === 'ios' && !bridge.watchLayout);
    };
    check();
    window.addEventListener('libretv:native-ready', check);
    return () => window.removeEventListener('libretv:native-ready', check);
  }, []);
  return legacy;
}

/** Durable native events are acknowledged only after the IndexedDB transaction commits. */
export function NativePlaybackSync() {
  const { verified } = useAuth();
  const { ready } = useFamily();
  useEffect(() => {
    if (!verified || !ready) return;
    let queue = Promise.resolve();
    const event = (raw: Event) => {
      const payload = parseNativeProgress((raw as CustomEvent).detail);
      if (!payload || payload.profileId !== activeSyncId) return;
      queue = queue.then(async () => {
        const current = await recordNativeProgress(payload);
        if (current && payload.rate && [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3].includes(payload.rate)) {
          try { localStorage.setItem('libretv-playback-rate', String(payload.rate)); } catch { /* optional */ }
        }
        nativePost({ type: 'ack', eventId: payload.eventId });
      }).catch(() => { /* Native keeps the event and resends after the next ready/foreground. */ });
    };
    const readyNative = () => nativePost({ type: 'ready' });
    window.addEventListener('libretv:native-progress', event);
    window.addEventListener('libretv:native-ready', readyNative);
    readyNative();
    return () => {
      window.removeEventListener('libretv:native-progress', event);
      window.removeEventListener('libretv:native-ready', readyNative);
    };
  }, [verified, ready]);
  return null;
}

export function NativePlayerPanel({ title, sourceKey, sourceUrl, vodId, episodes, index, ready, autoplayNext, getPosition, onEpisode, onSleep, onProgress }: {
  title: string; sourceKey: string; sourceUrl: string; vodId: string; episodes: string[]; index: number;
  ready: boolean; autoplayNext: boolean; getPosition: () => Promise<number>; onEpisode: (index: number) => void; onSleep: () => void; onProgress?: (position: number) => void;
}) {
  const [status, setStatus] = useState('点击进入全屏播放');
  const [resumable, setResumable] = useState(false);
  const [busy, setBusy] = useState(false);
  const sessionId = useRef('');
  const opening = useRef(false);
  const autoOpened = useRef(false);
  const lifecycle = useRef(0);
  const positionsRef = useRef(new Map<number, number>());
  const sequencesRef = useRef(new Map<number, number>());
  const callbacks = useRef({ onEpisode, onSleep, onProgress }); callbacks.current = { onEpisode, onSleep, onProgress };
  useEffect(() => {
    const generation = ++lifecycle.current;
    const receive = (raw: Event) => {
      const p = parseNativeProgress((raw as CustomEvent).detail);
      if (!p || p.sessionId !== sessionId.current) return;
      if (p.sequence <= (sequencesRef.current.get(p.index) ?? -1)) return;
      sequencesRef.current.set(p.index, p.sequence);
      positionsRef.current.set(p.index, p.ended ? 0 : p.position);
      callbacks.current.onProgress?.(p.ended ? 0 : p.position);
      setResumable(!p.ended && p.position > 0);
      if (p.reason === 'episode' || p.reason === 'close') callbacks.current.onEpisode(p.index);
      if (p.reason === 'sleep') callbacks.current.onSleep();
      if (p.reason === 'close') { opening.current = false; setBusy(false); setStatus(p.position > 0 && !p.ended ? '接着上次的进度播放' : '点击进入全屏播放'); }
      if (p.reason === 'error') setStatus('播放失败，请退出后重试或切换资源');
    };
    window.addEventListener('libretv:native-progress', receive);
    return () => { lifecycle.current = generation + 1; window.removeEventListener('libretv:native-progress', receive); nativePost({ type: 'close', sessionId: sessionId.current }); };
  }, []);
  useEffect(() => {
    if (!ready || opening.current) return;
    let cancelled = false;
    void (async () => {
      const position = positionsRef.current.get(index) ?? await getPosition();
      if (cancelled || opening.current) return;
      setResumable(position > 0);
      setStatus(position > 0 ? '接着上次的进度播放' : '点击进入全屏播放');
    })().catch(() => { /* The play action reports storage errors when retried. */ });
    return () => { cancelled = true; };
  }, [index, ready, getPosition]);
  const open = async () => {
    if (opening.current) return;
    opening.current = true;
    setBusy(true); setStatus('正在打开播放器…');
    const generation = lifecycle.current;
    try {
      const positions = await Promise.all(episodes.map((_, i) => db.progress.get(`${sourceKey}_${vodId}_${i}`)));
      const position = positionsRef.current.get(index) ?? await getPosition();
      const savedRate = Number(localStorage.getItem('libretv-playback-rate'));
      const session: NativeSession = {
        id: crypto.randomUUID(), title, sourceKey, sourceUrl, vodId, profileId: activeSyncId,
        index, episodes: episodes.map((url, i) => ({ url: new URL(url, location.origin).href, title: episodes.length > 1 ? `第 ${i + 1} 集` : title, position: i === index ? position : positionsRef.current.get(i) ?? positions[i]?.position ?? 0 })),
        rate: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3].includes(savedRate) ? savedRate : 1,
        autoplayNext, baseRevision: (await db.syncMeta.get('revision'))?.value || 0, openedAt: Date.now(),
      };
      if (generation !== lifecycle.current) return;
      sessionId.current = session.id;
      sequencesRef.current.clear();
      setResumable(position > 0);
      callbacks.current.onProgress?.(position);
      if (!nativePost({ type: 'open', session })) throw new Error('原生播放器尚未就绪，请稍后重试');
      setStatus('正在全屏播放');
    } catch (error) {
      if (generation !== lifecycle.current) return;
      opening.current = false; setBusy(false); setStatus(error instanceof Error ? error.message : '无法打开播放器，请重试或换源');
    }
  };
  const openRef = useRef(open); openRef.current = open;
  useEffect(() => scheduleNativeAutoOpen(() => void openRef.current(), autoOpened, ready), [ready]);
  const actionLabel = `${resumable ? '继续观看' : '播放影片'}${episodes.length > 1 ? ` · 第 ${index + 1} 集` : ''}`;
  return <button
    type="button"
    className="group flex min-h-[94px] w-full items-center justify-between gap-4 rounded-2xl border border-line bg-surface-raised px-5 py-[18px] text-left transition-colors enabled:hover:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-page disabled:cursor-default"
    aria-label={`${actionLabel}，打开全屏播放器`}
    disabled={!ready || busy}
    onClick={() => void open()}
  >
    <span className="grid min-w-0 gap-1.5">
      <span className="text-base font-medium leading-snug text-content">{actionLabel}</span>
      <span className="text-xs leading-relaxed text-muted [overflow-wrap:anywhere]" role="status">{!ready ? '正在准备播放…' : status}</span>
    </span>
    <span className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-full bg-accent/10 text-accent transition-colors group-enabled:group-hover:bg-accent/15" aria-hidden="true">
      {busy || !ready ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-accent/25 border-t-accent motion-reduce:animate-none" /> : <Icon name="play" className="ml-0.5 h-5 w-5 fill-current" />}
    </span>
  </button>;
}

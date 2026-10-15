'use client';
import { useEffect, useRef, useState } from 'react';
import { isNativeApp, nativePost, parseNativeProgress, type NativeSession } from '@/lib/native-player';
import { activeProfileId, db, recordNativeProgress } from '@/lib/db';
import { useAuth } from './auth';
import { useFamily } from './family';

export function useNativeApp() {
  const [native, setNative] = useState(false);
  useEffect(() => {
    const check = () => setNative(isNativeApp()); check();
    window.addEventListener('libretv:native-ready', check);
    return () => window.removeEventListener('libretv:native-ready', check);
  }, []);
  return native;
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
      if (!payload || payload.profileId !== activeProfileId) return;
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

export function NativePlayerPanel({ title, sourceKey, sourceUrl, vodId, episodes, index, autoplayNext, getPosition, onEpisode, onSleep, onWeb }: {
  title: string; sourceKey: string; sourceUrl: string; vodId: string; episodes: string[]; index: number;
  autoplayNext: boolean; getPosition: () => Promise<number>; onEpisode: (index: number) => void; onSleep: () => void; onWeb: () => void;
}) {
  const [status, setStatus] = useState('使用原生全屏播放器观看');
  const sessionId = useRef('');
  const opening = useRef(false);
  const callbacks = useRef({ onEpisode, onSleep }); callbacks.current = { onEpisode, onSleep };
  useEffect(() => {
    const receive = (raw: Event) => {
      const p = parseNativeProgress((raw as CustomEvent).detail);
      if (!p || p.sessionId !== sessionId.current) return;
      if (p.reason === 'episode' || p.reason === 'close') callbacks.current.onEpisode(p.index);
      if (p.reason === 'sleep') callbacks.current.onSleep();
      if (p.reason === 'close') { opening.current = false; setStatus('已保存进度，可以继续播放'); }
      if (p.reason === 'error') setStatus('原生播放失败，可返回后换源或使用网页播放');
    };
    window.addEventListener('libretv:native-progress', receive);
    return () => { window.removeEventListener('libretv:native-progress', receive); nativePost({ type: 'close', sessionId: sessionId.current }); };
  }, []);
  const open = async () => {
    if (opening.current) return;
    opening.current = true;
    try {
      const positions = await Promise.all(episodes.map((_, i) => db.progress.get(`${sourceKey}_${vodId}_${i}`)));
      const position = await getPosition();
      const savedRate = Number(localStorage.getItem('libretv-playback-rate'));
      const session: NativeSession = {
        id: crypto.randomUUID(), title, sourceKey, sourceUrl, vodId, profileId: activeProfileId,
        index, episodes: episodes.map((url, i) => ({ url: new URL(url, location.origin).href, title: `第 ${i + 1} 集`, position: i === index ? position : positions[i]?.position || 0 })),
        rate: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3].includes(savedRate) ? savedRate : 1,
        autoplayNext, baseRevision: (await db.syncMeta.get('revision'))?.value || 0, openedAt: Date.now(),
      };
      sessionId.current = session.id;
      if (!nativePost({ type: 'open', session })) throw new Error('原生播放器尚未就绪，请稍后重试');
      setStatus('正在原生全屏播放器中播放');
    } catch (error) { opening.current = false; setStatus(error instanceof Error ? error.message : '无法打开播放器'); }
  };
  return <div className="h-full flex flex-col items-center justify-center gap-3 px-4 text-white text-center">
    <p className="text-sm" role="status">{status}</p>
    <button className="btn-primary" onClick={() => void open()}>全屏播放</button>
    <button className="text-xs underline" onClick={() => { nativePost({ type: 'close', sessionId: sessionId.current }); onWeb(); }}>使用网页播放器</button>
  </div>;
}

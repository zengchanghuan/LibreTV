'use client';
import { useEffect } from 'react';
import { watchedSeconds, type PlaybackSample } from '@/lib/watch-sampling';

/** Independent observer: no player controls, progress storage or playback requests are changed. */
export function WatchTelemetry({ sourceKey, vodId, enabled, episode }: { sourceKey: string; vodId: string; enabled: boolean; episode: number }) {
  useEffect(() => {
    if (!enabled || !vodId) return;
    let stopped = false, session = '', seq = 0, pending = 0, duration = 0, inFlight = false, done = false;
    let previous: PlaybackSample | undefined, currentVideo: HTMLVideoElement | undefined;
    let retry: { seq: number; seconds: number; duration: number } | undefined;
    const controller = new AbortController();
    const request = (body: unknown) => fetch('/api/home/watch', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin', signal: controller.signal, body: JSON.stringify(body) });
    const send = async () => {
      if (inFlight || done || stopped || pending < 1 && !retry) return;
      inFlight = true;
      try {
        if (!session) {
          const response = await request({ action: 'start', sourceKey, vodId });
          if (!response.ok) return;
          const data = await response.json(); if (data.disabled) { done = true; return; }
          if (typeof data.session !== 'string') return;
          session = data.session; pending = 0; previous = undefined; return;
        }
        if (!retry) { const seconds = Math.min(30, pending); pending -= seconds; retry = { seq: seq + 1, seconds, duration }; }
        const response = await request({ action: 'heartbeat', session, ...retry });
        if (response.status === 400) { session = ''; seq = 0; retry = undefined; pending = 0; return; }
        if (!response.ok) return;
        const data = await response.json(); seq = retry.seq; retry = undefined;
        if (data.qualified || data.disabled) done = true;
      } catch { /* Statistics never interrupt playback. Retry the same sequence after network loss. */ }
      finally { inFlight = false; }
    };
    const sample = setInterval(() => {
      if (done) return;
      const video = [...document.querySelectorAll('video')].find(v => !v.paused && !v.ended);
      if (!video) { previous = undefined; return; }
      if (video !== currentVideo) { previous = undefined; currentVideo = video; }
      const current: PlaybackSample = { at: performance.now(), position: video.currentTime,
        playing: !video.paused && !video.ended && (!document.hidden || document.pictureInPictureElement === video),
        seeking: video.seeking, ready: video.readyState >= 3, rate: video.playbackRate };
      pending = Math.min(60, pending + watchedSeconds(previous, current)); previous = current;
      duration = Number.isFinite(video.duration) ? video.duration : 0;
      if (!session && pending >= 1) void send();
    }, 1000);
    const heartbeat = setInterval(() => void send(), 15_000);
    const pause = () => { previous = undefined; void send(); };
    const seek = () => { previous = undefined; };
    document.addEventListener('pause', pause, true); document.addEventListener('seeking', seek, true);
    return () => { stopped = true; controller.abort(); clearInterval(sample); clearInterval(heartbeat);
      document.removeEventListener('pause', pause, true); document.removeEventListener('seeking', seek, true); };
  }, [sourceKey, vodId, enabled, episode]);
  return null;
}

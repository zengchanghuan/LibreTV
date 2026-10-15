'use client';

import { useEffect, useRef, useState } from 'react';
import type Artplayer from 'artplayer';
import { sleepTimerExpired } from '@/lib/media-support';

/** Rendered inside ArtPlayer so it stays available in page/element fullscreen. */
export function PlaybackTools({ player, count, index, onEpisode, onSleep }: {
  player: Artplayer;
  count: number;
  index: number;
  onEpisode?: (index: number) => void;
  onSleep: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [rate, setRate] = useState(1);
  const [minutes, setMinutes] = useState(0);
  const [remaining, setRemaining] = useState('');
  const deadline = useRef<number | null>(null);
  const sleep = useRef(onSleep);
  const preferredRate = useRef(1);
  sleep.current = onSleep;

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem('libretv-playback-rate'));
      if ([0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3].includes(saved)) preferredRate.current = saved;
    } catch { /* Storage is optional for speed control. */ }
    const restoreRate = () => { player.video.defaultPlaybackRate = preferredRate.current; player.playbackRate = preferredRate.current; };
    restoreRate();
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = '播放'; button.setAttribute('aria-label', '倍速、选集与定时停止');
    button.className = 'playback-tools-button';
    button.onclick = () => setOpen(value => !value);
    player.controls.add({ name: 'playback-tools', position: 'right', index: 5, html: button });
    const rateChange = () => setRate(player.video.playbackRate);
    const checkDeadline = () => {
      if (!sleepTimerExpired(deadline.current, Date.now())) {
        if (deadline.current) setRemaining(`${Math.ceil((deadline.current - Date.now()) / 60_000)} 分钟后停止`);
        return;
      }
      deadline.current = null;
      setMinutes(0); setRemaining('已定时停止');
      // Cancel auto-next BEFORE pausing. Pause listeners may save progress or prefetch.
      sleep.current();
      player.pause();
      if (document.pictureInPictureElement === player.video) void document.exitPictureInPicture().catch(() => {});
    };
    player.video.addEventListener('ratechange', rateChange);
    player.video.addEventListener('loadedmetadata', restoreRate);
    player.video.addEventListener('timeupdate', checkDeadline);
    player.video.addEventListener('play', checkDeadline);
    player.video.addEventListener('ended', checkDeadline);
    document.addEventListener('visibilitychange', checkDeadline);
    window.addEventListener('pageshow', checkDeadline);
    const interval = setInterval(checkDeadline, 1000);
    return () => {
      clearInterval(interval);
      player.video.removeEventListener('ratechange', rateChange);
      player.video.removeEventListener('loadedmetadata', restoreRate);
      player.video.removeEventListener('timeupdate', checkDeadline);
      player.video.removeEventListener('play', checkDeadline);
      player.video.removeEventListener('ended', checkDeadline);
      document.removeEventListener('visibilitychange', checkDeadline);
      window.removeEventListener('pageshow', checkDeadline);
      if (!player.isDestroy) player.controls.remove('playback-tools');
    };
  }, [player]);

  return <>
    {remaining && <span className="playback-timer-status" role="status">{remaining}</span>}
    {open && <div className="playback-tools-panel" role="dialog" aria-label="播放设置" onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape') setOpen(false);
    }}>
      <div className="flex items-center justify-between"><strong>播放设置</strong><button onClick={() => setOpen(false)} aria-label="关闭播放设置">关闭</button></div>
      <label>播放速度<select value={rate} onChange={event => {
        const value = Number(event.target.value);
        preferredRate.current = value; player.video.defaultPlaybackRate = value; player.playbackRate = value;
        try { localStorage.setItem('libretv-playback-rate', String(value)); } catch { /* optional */ }
      }}>
        {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3].map(value => <option key={value} value={value}>{value} 倍速</option>)}
        {![0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3].includes(rate) && <option value={rate}>{rate} 倍速</option>}
      </select></label>
      {count > 1 && <label>播放选集<select value={index} onChange={event => { onEpisode?.(Number(event.target.value)); setOpen(false); }}>
        {Array.from({ length: count }, (_, i) => <option key={i} value={i}>第 {i + 1} 集</option>)}
      </select></label>}
      <label>定时停止<select value={minutes} onChange={event => {
        const value = Number(event.target.value);
        deadline.current = value ? Date.now() + value * 60_000 : null;
        setMinutes(value); setRemaining(value ? `${value} 分钟后停止` : '');
      }}>
        <option value={0}>关闭定时</option>
        {[15, 30, 45, 60, 90, 120].map(value => <option key={value} value={value}>{value} 分钟后停止</option>)}
      </select></label>
      <button onClick={() => { player.fullscreenWeb = !player.fullscreenWeb; setOpen(false); }}>切换页面全屏（保留选集）</button>
      <p>定时到点暂停并停止连播，不会关闭应用或锁屏。系统挂起页面时，返回应用后会立即检查。</p>
    </div>}
  </>;
}

'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type Artplayer from 'artplayer';
import { sleepTimerExpired } from '@/lib/media-support';

const MIN_RATE = 0.5;
const MAX_RATE = 3;
const RATE_STEP = 0.05;
const TIMER_MINUTES = [0, 15, 30, 45, 60, 90, 120];
const QUICK_RATES = [1, 1.25, 1.5, 2, 3];
const normalizeRate = (value: number) => Math.round(Math.min(MAX_RATE, Math.max(MIN_RATE, value)) * 20) / 20;

/** Rendered inside ArtPlayer so it stays available in page/element fullscreen. */
export function PlaybackTools({ player, count, index, onEpisode, onSleep }: {
  player: Artplayer;
  count: number;
  index: number;
  onEpisode?: (index: number) => void;
  onSleep: () => void;
}) {
  const [panel, setPanel] = useState<'speed' | 'settings' | null>(null);
  const [settingsTab, setSettingsTab] = useState<'episodes' | 'timer'>('timer');
  const [rate, setRate] = useState(1);
  const [minutes, setMinutes] = useState(0);
  const [remaining, setRemaining] = useState('');
  const deadline = useRef<number | null>(null);
  const sleep = useRef(onSleep);
  const preferredRate = useRef(1);
  const speedButton = useRef<HTMLButtonElement | null>(null);
  const gearButton = useRef<HTMLElement | null>(null);
  const settingsButton = useRef<HTMLButtonElement | null>(null);
  const panelElement = useRef<HTMLDivElement | null>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const panelId = useId();
  sleep.current = onSleep;

  useEffect(() => {
    player.template.$player.classList.add('art-has-playback-tools');
    try {
      const saved = Number(localStorage.getItem('libretv-playback-rate'));
      if (Number.isFinite(saved) && saved >= MIN_RATE && saved <= MAX_RATE) preferredRate.current = normalizeRate(saved);
    } catch { /* Storage is optional for speed control. */ }
    const restoreRate = () => {
      player.video.defaultPlaybackRate = preferredRate.current;
      player.playbackRate = preferredRate.current;
      setRate(player.video.playbackRate);
    };
    restoreRate();
    const speed = document.createElement('button');
    speed.type = 'button';
    speed.textContent = '播放速度';
    speed.className = 'playback-speed-menu-button';
    speed.setAttribute('aria-haspopup', 'dialog');
    speed.setAttribute('aria-controls', panelId);
    speedButton.current = speed;
    player.setting.add({
      name: 'persistent-playback-speed',
      html: speed,
      icon: player.icons.playbackRate.cloneNode(true) as HTMLElement,
      tooltip: `${preferredRate.current}× ›`,
      onClick: () => {
        player.setting.show = false;
        setPanel('speed');
        return `${preferredRate.current}× ›`;
      },
    });
    const gear = player.template.$player.querySelector<HTMLElement>('.art-control-setting');
    gearButton.current = gear;
    const gearKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        gear?.click();
      }
    };
    if (gear) {
      gear.tabIndex = 0;
      gear.setAttribute('role', 'button');
      gear.setAttribute('aria-label', '播放设置');
      gear.addEventListener('keydown', gearKeyDown);
    }
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = '选集/定时'; button.setAttribute('aria-label', '选集与定时停止');
    button.className = 'playback-tools-button';
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-controls', panelId);
    button.onclick = event => {
      event.stopPropagation();
      player.setting.show = false;
      setPanel(value => value === 'settings' ? null : 'settings');
    };
    settingsButton.current = button;
    player.controls.add({ name: 'playback-tools', position: 'right', index: 5, html: button });
    // Reflect temporary long-press acceleration without saving it as the preferred speed.
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
      speedButton.current = null;
      gear?.removeEventListener('keydown', gearKeyDown);
      gearButton.current = null;
      settingsButton.current = null;
      if (!player.isDestroy) {
        player.template.$player.classList.remove('art-has-playback-tools');
        player.setting.remove('persistent-playback-speed');
        player.controls.remove('playback-tools');
      }
    };
  }, [player, panelId]);

  useEffect(() => {
    if (speedButton.current) {
      speedButton.current.setAttribute('aria-label', `播放速度，当前 ${rate} 倍速`);
      speedButton.current.setAttribute('aria-expanded', String(panel === 'speed'));
    }
    const speedSetting = player.setting.find('persistent-playback-speed');
    if (speedSetting) speedSetting.tooltip = `${rate}× ›`;
    settingsButton.current?.setAttribute('aria-expanded', String(panel === 'settings'));
  }, [rate, panel, player]);

  useEffect(() => {
    const button = settingsButton.current;
    if (!button) return;
    button.textContent = count > 1 ? '选集/定时' : '定时';
    button.setAttribute('aria-label', count > 1 ? '选集与定时停止' : '定时停止');
  }, [count, player]);

  useEffect(() => {
    if (!panel) {
      restoreFocus.current?.focus();
      restoreFocus.current = null;
      return;
    }
    player.controls.show = true;
    const selected = panel === 'settings' ? panelElement.current?.querySelector<HTMLElement>('.playback-overlay-option[aria-pressed="true"]') : null;
    (selected ?? panelElement.current?.querySelector<HTMLElement>('input, button'))?.focus({ preventScroll: true });
    // Reveal the selection inside the drawer without scrolling the watch page.
    const scroller = selected?.closest('.playback-settings-scroll');
    if (selected && scroller) {
      const item = selected.getBoundingClientRect(), viewport = scroller.getBoundingClientRect();
      if (item.top < viewport.top) scroller.scrollTop += item.top - viewport.top;
      else if (item.bottom > viewport.bottom) scroller.scrollTop += item.bottom - viewport.bottom;
    }
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelElement.current?.contains(target) && !speedButton.current?.contains(target) && !settingsButton.current?.contains(target)) setPanel(null);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [panel, player]);

  const closePanel = () => {
    player.controls.show = true;
    restoreFocus.current = (panel === 'speed' ? gearButton : settingsButton).current;
    setPanel(null);
  };

  const backToSettings = () => {
    setPanel(null);
    player.controls.show = true;
    player.setting.show = true;
    speedButton.current?.focus();
  };

  const changeRate = (value: number) => {
    const nextRate = normalizeRate(value);
    preferredRate.current = nextRate;
    player.video.defaultPlaybackRate = nextRate;
    player.playbackRate = nextRate;
    setRate(player.video.playbackRate);
    try { localStorage.setItem('libretv-playback-rate', String(nextRate)); } catch { /* optional */ }
  };

  const chooseTimer = (value: number) => {
    deadline.current = value ? Date.now() + value * 60_000 : null;
    setMinutes(value);
    setRemaining(value ? `${value} 分钟后停止` : '');
    closePanel();
  };

  return <>
    {remaining && <span className="playback-timer-status" role="status">{remaining}</span>}
    {panel === 'speed' && <div ref={panelElement} id={panelId} className="playback-tools-panel playback-speed-panel" role="dialog" aria-label="播放速度" onClick={event => event.stopPropagation()} onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape') closePanel();
    }}>
      <div className="playback-tools-heading"><div className="playback-tools-title"><button type="button" onClick={backToSettings} aria-label="返回播放设置">‹</button><strong>播放速度</strong></div><button type="button" onClick={closePanel} aria-label="关闭播放速度">关闭</button></div>
      <output className="playback-speed-value" htmlFor={`${panelId}-range`}>{rate.toFixed(2)}×</output>
      <div className="playback-speed-slider">
        <button type="button" onClick={() => changeRate(rate - RATE_STEP)} disabled={rate <= MIN_RATE} aria-label="降低速度 0.05 倍">−</button>
        <input id={`${panelId}-range`} type="range" aria-label="播放速度" aria-valuetext={`${rate} 倍速`} min={MIN_RATE} max={MAX_RATE} step={RATE_STEP} value={rate} onChange={event => changeRate(Number(event.target.value))} />
        <button type="button" onClick={() => changeRate(rate + RATE_STEP)} disabled={rate >= MAX_RATE} aria-label="提高速度 0.05 倍">＋</button>
      </div>
      <div className="playback-speed-presets" role="group" aria-label="常用倍速">
        {QUICK_RATES.map(value => <button type="button" key={value} aria-pressed={rate === value} onClick={() => changeRate(value)}>{value}×</button>)}
      </div>
    </div>}
    {panel === 'settings' && <div className="playback-settings-overlay"
      onPointerDown={event => event.stopPropagation()}
      onTouchStart={event => event.stopPropagation()}
      onTouchMove={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
      onDoubleClick={event => event.stopPropagation()}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); closePanel(); }
        if (event.key !== 'Tab') return;
        const buttons = panelElement.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
        if (!buttons?.length) return;
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}>
      <button type="button" className="playback-settings-backdrop" tabIndex={-1} aria-label="收起播放面板" onClick={closePanel} />
      <div ref={panelElement} id={panelId} className="playback-settings-drawer" role="dialog" aria-modal="true" aria-label={count > 1 ? '选集与定时停止' : '定时停止'}>
        <div className="playback-settings-header">
          {count > 1 ? <div className="playback-settings-tabs" role="group" aria-label="播放面板">
            <button type="button" aria-pressed={settingsTab === 'episodes'} onClick={() => setSettingsTab('episodes')}>选集</button>
            <button type="button" aria-pressed={settingsTab === 'timer'} onClick={() => setSettingsTab('timer')}>定时</button>
          </div> : <span>定时停止</span>}
          <button type="button" className="playback-settings-close" onClick={closePanel} aria-label="收起播放面板"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg></button>
        </div>
        <div className="playback-settings-scroll">
          {count > 1 && settingsTab === 'episodes' ? <div className="playback-overlay-list" role="group" aria-label="播放选集">
            {Array.from({ length: count }, (_, i) => <button type="button" key={i} className="playback-overlay-option" aria-pressed={index === i} onClick={() => { closePanel(); onEpisode?.(i); }}>
              <span className="playback-option-check" aria-hidden="true">{index === i ? '✓' : ''}</span><span>第 {i + 1} 集</span>
            </button>)}
          </div> : <>
            <div className="playback-overlay-list" role="group" aria-label="定时时长">
              {TIMER_MINUTES.map(value => <button type="button" key={value} className="playback-overlay-option" aria-pressed={minutes === value} onClick={() => chooseTimer(value)}>
                <span className="playback-option-check" aria-hidden="true">{minutes === value ? '✓' : ''}</span><span>{value ? `${value} 分钟` : '关闭'}</span>
              </button>)}
            </div>
            <p className="playback-settings-note">{minutes ? `剩余 ${remaining.replace('后停止', '')} · ` : ''}到时暂停并停止连播</p>
          </>}
        </div>
      </div>
    </div>}
  </>;
}

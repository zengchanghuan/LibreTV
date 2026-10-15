'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Drawer } from './drawer';
import { isNativeApp } from '@/lib/native-player';

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
const InstallContext = createContext({ installed: false, show: () => {} });

export function InstallButton() {
  const { installed, show } = useContext(InstallContext);
  if (installed) return null;
  return <button className="btn-ghost btn-sm" onClick={show} aria-label="安装 LibreTV">安装</button>;
}

export function InstallBanner() {
  const { installed } = useContext(InstallContext);
  if (installed) return null;
  return <div className="sm:hidden flex items-center justify-between gap-3 px-4 pb-2 text-xs text-muted"><span>添加到主屏幕，下次一键打开</span><InstallButton /></div>;
}

export function PwaProvider({ children }: { children: ReactNode }) {
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [notice, setNotice] = useState('');
  const requestedUpdate = useRef(false);

  useEffect(() => {
    const display = matchMedia('(display-mode: standalone)');
    const updateDisplay = () => setInstalled(isNativeApp() || display.matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    updateDisplay();
    setIos(/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
    const onPrompt = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt); };
    const onInstalled = () => { setInstalled(true); setPrompt(null); setOpen(false); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    window.addEventListener('libretv:native-ready', updateDisplay);
    display.addEventListener('change', updateDisplay);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      window.removeEventListener('libretv:native-ready', updateDisplay);
      display.removeEventListener('change', updateDisplay);
    };
  }, []);

  useEffect(() => {
    if (isNativeApp() || !('serviceWorker' in navigator) || !window.isSecureContext || process.env.NODE_ENV !== 'production') return;
    let disposed = false;
    let registration: ServiceWorkerRegistration | undefined;
    const reload = () => { if (requestedUpdate.current) location.reload(); };
    const check = () => { if (!document.hidden) void registration?.update().catch(() => {}); };
    navigator.serviceWorker.addEventListener('controllerchange', reload);
    document.addEventListener('visibilitychange', check);
    void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then(reg => {
      if (disposed) return;
      registration = reg;
      if (reg.waiting) setWaiting(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        worker?.addEventListener('statechange', () => {
          if (!disposed && worker.state === 'installed' && navigator.serviceWorker.controller) setWaiting(reg.waiting);
        });
      });
    }).catch(() => { /* Online use remains available when storage or registration is blocked. */ });
    return () => {
      disposed = true;
      navigator.serviceWorker.removeEventListener('controllerchange', reload);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);

  const install = async () => {
    if (!prompt) return;
    try { await prompt.prompt(); await prompt.userChoice; }
    catch { setNotice('请使用浏览器菜单中的“安装应用”或“添加到主屏幕”。'); }
    finally { setPrompt(null); }
  };
  const activate = () => {
    if (Array.from(document.querySelectorAll('video')).some(video => !video.paused && !video.ended)) {
      setNotice('请先暂停视频，再更新应用。'); return;
    }
    requestedUpdate.current = true;
    waiting?.postMessage({ type: 'ACTIVATE_UPDATE' });
  };

  return <InstallContext.Provider value={{ installed, show: () => setOpen(true) }}>
    {children}
    {waiting && <div className="pwa-update" role="status">
      <span>{notice || '新版已就绪，更新会重新打开当前页面。'}</span>
      <button className="btn-primary shrink-0" onClick={activate}>更新</button>
    </div>}
    <Drawer open={open} onClose={() => setOpen(false)} title="安装 LibreTV">
      <div className="space-y-5 text-sm leading-7">
        <p>放到主屏幕，下次点图标即可打开。各设备登录同一服务并选择同一家庭成员，即可同步观看记录。</p>
        {ios ? <ol className="list-decimal pl-5 space-y-3">
          <li>用 <strong>Safari</strong> 打开本站；微信等应用内请先选择“在浏览器打开”。</li>
          <li>点击“分享”，选择“添加到主屏幕”。</li>
          <li>如有“作为 Web App 打开”选项，请保持开启，然后点击“添加”。</li>
        </ol> : <>
          {prompt && <button className="btn-primary w-full" onClick={() => void install()}>安装到设备</button>}
          <p>也可以打开浏览器菜单，选择“安装应用”或“添加到主屏幕”。Android 推荐使用最新版 Chrome；不同浏览器的菜单名称可能不同。</p>
        </>}
        {!windowSafeSecure() && <p className="text-warning">请通过 HTTPS 地址访问后再安装。</p>}
        <p className="text-muted">安装后若提示登录，请再次输入家庭访问密码。网页与主屏幕应用的本地记录可能分开保存，选择同一成员后会从服务器同步。</p>
      </div>
    </Drawer>
  </InstallContext.Provider>;
}

function windowSafeSecure() { return typeof window === 'undefined' || window.isSecureContext; }

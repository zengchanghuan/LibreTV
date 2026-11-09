'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { Icon } from './icon';
import { useFocusTrap } from './use-focus-trap';

export function WatchMoreSheet({ multipleEpisodes, downloadUnavailable, onDownload, onSync, onClose }: {
  multipleEpisodes: boolean;
  downloadUnavailable: boolean;
  onDownload: () => void;
  onSync: () => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useFocusTrap(true, panel);
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', escape);
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', escape); };
  }, [onClose]);
  return <div className="fixed inset-0 z-[65] flex items-end justify-center bg-black/60 sm:items-center sm:p-4" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={panel} role="dialog" aria-modal="true" aria-label="更多操作" tabIndex={-1} className="w-full max-w-md rounded-t-2xl border border-line bg-surface-raised px-5 pt-3 pb-[max(20px,env(safe-area-inset-bottom))] shadow-2xl outline-none sm:rounded-2xl">
      <div className="mx-auto mb-2 h-1 w-8 rounded-full bg-faint/40 sm:hidden" aria-hidden="true" />
      <div className="mb-2 flex items-center justify-between"><h2 className="text-lg font-semibold">更多操作</h2><button className="btn-ghost !min-h-11 !min-w-11 !p-2" aria-label="关闭更多操作" onClick={onClose}><Icon name="close" /></button></div>
      <button className="flex min-h-14 w-full items-center gap-3 border-b border-line text-left text-sm disabled:text-faint" disabled={downloadUnavailable} onClick={onDownload}><Icon name="download" /><span>{multipleEpisodes ? '下载本集' : '下载影片'}{downloadUnavailable && <span className="ml-2 text-xs">当前资源暂不支持下载</span>}</span></button>
      <button className="flex min-h-14 w-full items-center gap-3 border-b border-line text-left text-sm" onClick={onSync}><Icon name="cloud" />播放历史与同步</button>
      <Link href="/" className="flex min-h-14 items-center gap-3 text-sm" onClick={onClose}><Icon name="home" />回到首页</Link>
    </div>
  </div>;
}

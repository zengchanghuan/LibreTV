'use client';

import { SmartImage } from './smart-image';
import { useEffect, useRef, useState } from 'react';

/** A useful card face remains visible while loading and after every image candidate fails. */
export function FilmPoster({ title, year, url, mode, customProxy, onExhausted, imageAlt }: {
  title: string; year?: string; url?: string; mode: 'direct' | 'proxy' | 'custom';
  customProxy?: string; onExhausted?: () => void; imageAlt?: string;
}) {
  const imageKey = JSON.stringify([url, mode, customProxy]);
  const [loadedKey, setLoadedKey] = useState('');
  const imageRoot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const image = imageRoot.current?.querySelector('img');
    if (image?.complete && image.naturalWidth > 0) setLoadedKey(imageKey);
  }, [imageKey]);
  return <div className="relative h-full w-full overflow-hidden">
    <div aria-hidden="true" className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-slate-700 via-slate-800 to-slate-950 p-4 text-center text-slate-200">
      <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-9 w-9 opacity-60"><rect x="4" y="5" width="24" height="22" rx="3" /><path d="M10 5v22M22 5v22M4 12h6M4 20h6M22 12h6M22 20h6M14 12l6 4-6 4z" /></svg>
      <span className="line-clamp-3 text-sm font-medium leading-6">{title}</span>
      {year && <span className="text-xs text-slate-400">{year}</span>}
    </div>
    {url && <div ref={imageRoot} className={`absolute inset-0 ${loadedKey === imageKey ? 'opacity-100' : 'opacity-0'}`}
      onLoadCapture={() => setLoadedKey(imageKey)} onErrorCapture={() => setLoadedKey('')}>
      <SmartImage key={url} url={url} mode={url.startsWith('/') ? 'direct' : mode} customProxy={customProxy}
        alt={imageAlt || `${title}海报`} onExhausted={onExhausted} className="h-full w-full object-cover" />
    </div>}
  </div>;
}

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { continueWatching } from '@/lib/home-continue';
import { resolveSource, useAppStore } from '@/lib/store';
import { buildWatchUrl } from '@/lib/utils';
import { SmartImage } from './smart-image';
import { HistoryPanel } from './history-panel';

export function HomeContinue() {
  const store = useAppStore(), [historyOpen, setHistoryOpen] = useState(false);
  const history = useLiveQuery(async () => {
    try { return await db.history.orderBy('timestamp').reverse().limit(100).toArray(); }
    catch { return []; }
  }, []);
  const items = continueWatching(history || []);
  if (!items.length) return null;
  return <section aria-label="继续观看" className="mb-9">
    <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-semibold">继续观看</h2>
      <button className="btn-ghost btn-sm" onClick={() => setHistoryOpen(true)}>全部记录 →</button></div>
    <div className="grid gap-3 sm:grid-cols-2">{items.map(item => {
      const source = resolveSource(store, item.sourceKey);
      return <Link key={item.id} href={buildWatchUrl({ sourceKey: item.sourceKey, sourceUrl: source?.url || item.sourceUrl,
        detail: source?.detail, vodId: item.vodId, title: item.title, index: item.episodeIndex })}
        className="flex min-w-0 gap-4 rounded-xl border border-line bg-surface p-3 transition-colors hover:bg-hover">
        <div className="h-20 w-14 shrink-0 overflow-hidden rounded-lg bg-chip">{item.pic && <SmartImage url={item.pic} alt=""
          mode={store.imageProxyMode} customProxy={store.customImageProxy} className="h-full w-full object-cover" />}</div>
        <div className="min-w-0 flex-1 self-center"><h3 className="truncate text-sm font-semibold">{item.title}</h3>
          <p className="mt-1 text-xs text-muted">{item.nextEpisode ? `继续第 ${item.episodeIndex + 1} 集` : `${item.totalEpisodes > 1 ? `第 ${item.episodeIndex + 1} 集 · ` : ''}看到 ${Math.floor(item.playbackPosition / 60)} 分钟`}</p>
          {item.duration > 0 && <div role="progressbar" aria-label={`${item.title} 观看进度`} aria-valuenow={Math.round(item.playbackPosition / item.duration * 100)} aria-valuemin={0} aria-valuemax={100}
            className="mt-3 h-1 overflow-hidden rounded-full bg-chip"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, item.playbackPosition / item.duration * 100)}%` }} /></div>}
        </div><span className="self-center text-accent" aria-hidden="true">▶</span>
      </Link>;
    })}</div>
    <HistoryPanel open={historyOpen} onClose={() => setHistoryOpen(false)} />
  </section>;
}

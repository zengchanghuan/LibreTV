'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { QUALITY_TTL, updateQuality, type PlaybackDelta, type PlaybackQuality } from './playback-quality';
interface State {
  entries: Record<string, PlaybackQuality>;
  record: (source: string, delta: PlaybackDelta) => void;
  probe: (source: string, result: { ok: boolean; ms: number; kbps?: number }) => void;
}
function compact(entries: Record<string, PlaybackQuality>) {
  return Object.fromEntries(Object.entries(entries).filter(([,v]) => Date.now() - v.at < QUALITY_TTL).sort((a,b) => b[1].at - a[1].at).slice(0,200));
}
export const usePlaybackQuality = create<State>()(persist((set) => ({
  entries: {},
  record: (source, delta) => { if (source) set(s => ({ entries: compact({ ...s.entries, [source]: updateQuality(s.entries[source], delta) }) })); },
  probe: (source, result) => set(s => { const old = s.entries[source]; const fresh = old && Date.now() - old.at < QUALITY_TTL ? old : undefined;
    return { entries: compact({ ...s.entries, [source]: { starts: 0, playedMs: 0, stalledMs: 0, stalls: 0, ...fresh, at: Date.now(), probe: { ...result, at: Date.now() } } }) }; }),
}), { name: 'libretv-playback-quality-v1', partialize: s => ({ entries: s.entries }) }));

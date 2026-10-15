'use client';
import { useCallback, useEffect, useState } from 'react';
import { resolveSource, useAppStore } from '@/lib/store';
import { clearMediaProbeCache, probePool, probeVideo, type MediaProbe } from '@/lib/media-probe';
import { qualityScore } from '@/lib/playback-quality';
import { usePlaybackQuality } from '@/lib/playback-quality-store';
import type { SearchResultItem } from '@/lib/types';
export function useRankedSources(items: SearchResultItem[], active: boolean, index = 0) {
  const entries = usePlaybackQuality(s => s.entries);
  const [probes, setProbes] = useState<Record<string, MediaProbe>>({});
  const [testing, setTesting] = useState(false);
  const [networkEpoch, setNetworkEpoch] = useState(0);
  const retest = useCallback(() => {
    clearMediaProbeCache(); usePlaybackQuality.getState().resetNetwork();
    setNetworkEpoch(value => value + 1);
  }, []);
  useEffect(() => {
    const connection = (navigator as Navigator & { connection?: EventTarget }).connection;
    window.addEventListener('online', retest);
    connection?.addEventListener('change', retest);
    return () => { window.removeEventListener('online', retest); connection?.removeEventListener('change', retest); };
  }, [retest]);
  const identity = items.map(i => `${i.sourceKey}:${i.vodId}:${i.sourceUrl}`).join('|');
  const keyOf = (item: SearchResultItem) => item.sourceUrl || resolveSource(useAppStore.getState(), item.sourceKey)?.url || item.sourceKey;
  useEffect(() => {
    if (!active || !items.length) return;
    const controller = new AbortController(); setTesting(true); setProbes({});
    void probePool(items, async item => {
      const source = resolveSource(useAppStore.getState(), item.sourceKey, { url: item.sourceUrl });
      if (!source) return;
      const result = await probeVideo(source, item.vodId, index, controller.signal);
      if (controller.signal.aborted) return;
      usePlaybackQuality.getState().probe(source.url, result);
      setProbes(p => ({ ...p, [`${item.sourceKey}:${item.vodId}`]: result }));
    }, controller.signal).catch(() => {}).finally(() => { if (!controller.signal.aborted) setTesting(false); });
    return () => controller.abort();
    // Items arrive incrementally from search; their content identity, not the array reference, controls probing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, active, index, networkEpoch]);
  const ranked = [...items].sort((a,b) => qualityScore(entries[keyOf(a)]) - qualityScore(entries[keyOf(b)]));
  const best = ranked.find(i => probes[`${i.sourceKey}:${i.vodId}`]?.ok);
  return { ranked, entries, probes, testing, best, keyOf, retest };
}

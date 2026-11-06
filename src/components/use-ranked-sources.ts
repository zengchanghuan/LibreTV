'use client';
import { useCallback, useEffect, useState } from 'react';
import { resolveSource, useAppStore } from '@/lib/store';
import { clearMediaProbeCache, probePool, probeVideo, type MediaProbe } from '@/lib/media-probe';
import { compareSourcePreference, mediaPreferenceLabel } from '@/lib/source-preference';
import { usePlaybackQuality } from '@/lib/playback-quality-store';
import type { SearchResultItem } from '@/lib/types';
export function useRankedSources(items: SearchResultItem[], active: boolean, index = 0) {
  const entries = usePlaybackQuality(s => s.entries);
  const [snapshot, setSnapshot] = useState<{ scope: string; probes: Record<string, MediaProbe> }>({ scope: '', probes: {} });
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
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(retest, 5 * 60_000);
    return () => clearInterval(timer);
  }, [active, retest]);
  const identity = JSON.stringify(items.map(i => [i.sourceKey, i.vodId, i.sourceUrl]));
  const scope = JSON.stringify([identity, index, networkEpoch, active]);
  const keyOf = (item: SearchResultItem) => item.sourceUrl || resolveSource(useAppStore.getState(), item.sourceKey)?.url || item.sourceKey;
  const probeKey = (item: SearchResultItem) => JSON.stringify([keyOf(item), item.sourceKey, item.vodId, index]);
  const probes = snapshot.scope === scope ? snapshot.probes : {};
  const probeOf = (item: SearchResultItem) => probes[probeKey(item)];
  useEffect(() => {
    if (!active || !items.length) return;
    const controller = new AbortController(); setTesting(true); setSnapshot({ scope, probes: {} });
    void probePool(items, async item => {
      const source = resolveSource(useAppStore.getState(), item.sourceKey, { url: item.sourceUrl });
      if (!source) return;
      const result = await probeVideo(source, item.vodId, index, controller.signal);
      if (controller.signal.aborted) return;
      usePlaybackQuality.getState().probe(source.url, result);
      setSnapshot(p => p.scope === scope ? { scope, probes: { ...p.probes, [probeKey(item)]: result } } : p);
    }, controller.signal).catch(() => {}).finally(() => { if (!controller.signal.aborted) setTesting(false); });
    return () => controller.abort();
    // Items arrive incrementally from search; their content identity, not the array reference, controls probing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);
  const preferenceOf = (item: SearchResultItem) => ({ probe: probeOf(item), history: entries[keyOf(item)], remarks: item.remarks });
  const ranked = [...items].sort((a, b) => compareSourcePreference(preferenceOf(a), preferenceOf(b)));
  const best = ranked.find(i => probeOf(i)?.ok);
  const labelOf = (item: SearchResultItem) => mediaPreferenceLabel(probeOf(item), item.remarks);
  return { ranked, entries, probes, probeOf, labelOf, testing: active && testing, best, keyOf, retest };
}

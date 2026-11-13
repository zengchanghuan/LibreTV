'use client';
import { useCallback, useEffect, useState } from 'react';
import { resolveSource, useAppStore } from '@/lib/store';
import { clearMediaProbeCache, probePool, probeVideo, type MediaProbe } from '@/lib/media-probe';
import { compareSourcePreference, mediaPreferenceLabel } from '@/lib/source-preference';
import { usePlaybackQuality } from '@/lib/playback-quality-store';
import type { SearchResultItem } from '@/lib/types';
import { canRecommendSource } from '@/lib/source-content-corrections';

type ProbePhase = 'probing' | 'subtitles' | 'done' | 'excluded';
interface Snapshot {
  scope: string;
  probes: Record<string, MediaProbe>;
  phases: Record<string, ProbePhase>;
  complete: boolean;
}
const sourceOf = (item: SearchResultItem) => resolveSource(useAppStore.getState(), item.sourceKey, { url: item.sourceUrl });
const eligible = (item: SearchResultItem) => canRecommendSource(item, sourceOf(item)?.url || item.sourceUrl);
const keyOf = (item: SearchResultItem) => item.sourceUrl || sourceOf(item)?.url || item.sourceKey;

export function useRankedSources(items: SearchResultItem[], active: boolean, index = 0) {
  const entries = usePlaybackQuality(s => s.entries);
  const [snapshot, setSnapshot] = useState<Snapshot>({ scope: '', probes: {}, phases: {}, complete: false });
  const [networkEpoch, setNetworkEpoch] = useState(0);
  const identity = JSON.stringify(items.map(i => [i.sourceKey, i.vodId, i.sourceUrl]));
  const retest = useCallback(() => {
    // Refresh this film/episode only; keep other films and real playback history.
    const targets = JSON.parse(identity) as [string, string, string | undefined][];
    for (const [sourceKey, vodId, sourceUrl] of targets) {
      const source = resolveSource(useAppStore.getState(), sourceKey, { url: sourceUrl });
      if (source) clearMediaProbeCache(source, vodId, index);
    }
    setNetworkEpoch(value => value + 1);
  }, [identity, index]);
  useEffect(() => {
    const connection = (navigator as Navigator & { connection?: EventTarget }).connection;
    const networkChanged = () => {
      clearMediaProbeCache();
      usePlaybackQuality.getState().resetNetwork();
      setNetworkEpoch(value => value + 1);
    };
    window.addEventListener('online', networkChanged);
    connection?.addEventListener('change', networkChanged);
    return () => { window.removeEventListener('online', networkChanged); connection?.removeEventListener('change', networkChanged); };
  }, []);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(retest, 5 * 60_000);
    return () => clearInterval(timer);
  }, [active, retest]);
  const scope = JSON.stringify([identity, index, networkEpoch, active]);
  const probeKey = (item: SearchResultItem) => JSON.stringify([keyOf(item), item.sourceKey, item.vodId, index]);
  const current = snapshot.scope === scope ? snapshot : undefined;
  const probes = current?.probes ?? {};
  const probeOf = (item: SearchResultItem) => probes[probeKey(item)];
  useEffect(() => {
    if (!active || !items.length) return;
    const controller = new AbortController();
    setSnapshot({ scope, probes: {}, phases: {}, complete: false });
    const publish = (key: string, phase: ProbePhase, result?: MediaProbe) => {
      if (controller.signal.aborted) return;
      setSnapshot(p => p.scope === scope ? {
        ...p, phases: { ...p.phases, [key]: phase },
        probes: result ? { ...p.probes, [key]: result } : p.probes,
      } : p);
    };
    // Start with the most promising history instead of search arrival order.
    const history = usePlaybackQuality.getState().entries;
    const queued = [...items].sort((a, b) => compareSourcePreference(
      { history: history[keyOf(a)], remarks: a.remarks },
      { history: history[keyOf(b)], remarks: b.remarks },
    ));
    void probePool(queued, async item => {
      const key = probeKey(item);
      if (!eligible(item)) { publish(key, 'excluded'); return; }
      publish(key, 'probing');
      const source = sourceOf(item);
      let result: MediaProbe;
      try {
        result = source
          ? await probeVideo(source, item.vodId, index, controller.signal, value => publish(key, 'subtitles', value))
          : { ok: false, ms: 0, episodes: 0, subtitles: 'unknown', error: '来源配置不可用' };
      } catch (error) {
        if (controller.signal.aborted) return;
        result = { ok: false, ms: 0, episodes: 0, subtitles: 'unknown', error: error instanceof Error ? error.message : '检测失败' };
      }
      if (controller.signal.aborted) return;
      if (source) usePlaybackQuality.getState().probe(source.url, result);
      publish(key, 'done', result);
    }, controller.signal).finally(() => {
      if (!controller.signal.aborted) setSnapshot(p => p.scope === scope ? { ...p, complete: true } : p);
    });
    return () => controller.abort();
    // Content identity controls probing; result updates must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);
  const preferenceOf = (item: SearchResultItem) => ({ probe: probeOf(item), history: entries[keyOf(item)], remarks: item.remarks });
  const ranked = [...items].sort((a, b) => compareSourcePreference(preferenceOf(a), preferenceOf(b)));
  const best = ranked.find(i => eligible(i) && probeOf(i)?.ok);
  const statusOf = (item: SearchResultItem) => {
    if (!eligible(item)) return '内容不符 · 已隔离';
    const phase = current?.phases[probeKey(item)];
    if (!phase) return '排队中';
    if (phase === 'probing') return '检测中';
    if (phase === 'subtitles') return '视频已通过 · 补充字幕中';
    const probe = probeOf(item);
    return probe?.ok ? '检测完成' : probe?.timedOut ? '检测超时' : '检测未通过';
  };
  const labelOf = (item: SearchResultItem) => eligible(item) ? mediaPreferenceLabel(probeOf(item), item.remarks) : '待核实，不参与智能优选';
  const progress = {
    done: items.filter(item => probeOf(item) !== undefined).length,
    total: items.filter(eligible).length,
    ok: items.filter(item => probeOf(item)?.ok).length,
    subtitles: items.filter(item => current?.phases[probeKey(item)] === 'subtitles').length,
  };
  return { ranked, entries, probes, probeOf, labelOf, statusOf, progress,
    testing: active && items.length > 0 && !current?.complete, best, keyOf, retest };
}

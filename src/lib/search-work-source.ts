import { searchSource } from './search-source';
import { prepareWorkSearchResults, workResultStatus, type SearchPlan } from './work-search';
import { readSourceVideoDetails } from './source-video-details';
import type { SearchResultItem, SourceConfig, SourceSearchOutcome } from './types';

/** Two names share one source budget and one final health event. Progress never affects health. */
export async function searchWorkSource(source: SourceConfig, plan: SearchPlan, options: {
  signal?: AbortSignal;
  filterAdult?: boolean;
  onProgress?: (outcome: SourceSearchOutcome) => void;
  timeoutMs?: number;
} = {}): Promise<SourceSearchOutcome> {
  if (!plan.strict && plan.titles.length === 1) {
    const outcome = await searchSource(source, plan.query, { signal: options.signal });
    return { ...outcome, list: prepareWorkSearchResults(outcome.list, plan, options.filterAdult) };
  }
  options.signal?.throwIfAborted();
  const start = Date.now(), timeoutMs = options.timeoutMs ?? 10000;
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const outcomes: SourceSearchOutcome[] = [];
  let items: SearchResultItem[] = [], incomplete = false, closed = false;
  const snapshot = (timedOut = false): SourceSearchOutcome => {
    const ok = outcomes.some(o => o.ok);
    const partial = incomplete || outcomes.length < plan.titles.length || outcomes.some(o => !o.ok || o.partial);
    return { sourceKey: source.key, ok, list: prepareWorkSearchResults(items, plan, options.filterAdult), ms: Date.now() - start,
      ...(partial ? { partial: ok, error: ok ? '部分名称或资料查询未完成' : outcomes.find(o => o.error)?.error || '源搜索超时' } : {}),
      ...(timedOut || outcomes.some(o => o.timedOut) ? { timedOut: true } : {}) };
  };
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<SourceSearchOutcome>(resolve => {
    timer = setTimeout(() => {
      controller.abort(new DOMException('源搜索超时', 'TimeoutError'));
      resolve(snapshot(true));
    }, timeoutMs);
  });
  const run = async () => {
    await Promise.all(plan.titles.map(async title => {
      const outcome = await searchSource(source, title, { signal, maxPages: 2, timeoutMs: Math.min(timeoutMs, 7000),
        matchTitles: plan.work ? [plan.work.title, ...plan.work.aliases] : plan.titles });
      if (closed) return;
      outcomes.push(outcome);
      items = prepareWorkSearchResults([...items, ...outcome.list], plan, options.filterAdult);
      options.onProgress?.({ ...snapshot(), partial: undefined });
    }));
    signal.throwIfAborted();
    // At most three metadata lookups, in parallel, inside the same ten-second budget.
    const missing = items.filter(item => workResultStatus(item, plan) === 'unconfirmed').slice(0, 3);
    await Promise.all(missing.map(async item => {
      try {
        const detail = await readSourceVideoDetails(source, item.vodId, signal);
        if (closed) return;
        const enriched = { ...item, name: detail.title || item.name, year: detail.year || item.year,
          typeName: detail.typeName || item.typeName, pic: item.pic || detail.cover };
        items = items.map(old => old === item ? enriched : old);
      } catch {
        incomplete = true;
      }
    }));
    return snapshot();
  };
  try {
    const result = await Promise.race([run().catch(() => { incomplete = true; return snapshot(signal.aborted); }), deadline]);
    options.signal?.throwIfAborted();
    return result;
  } finally {
    closed = true;
    clearTimeout(timer!);
    controller.abort();
  }
}

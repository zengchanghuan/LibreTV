import { searchWorkSource } from '@/lib/search-work-source';
import { buildSearchPlan, prepareWorkSearchResults, readSearchContext, type SearchContext, type SearchPlan } from '@/lib/work-search';
import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { getCache, setCache } from '@/lib/fetch-utils';
import type { SearchResponse, SearchStreamEvent, SourceConfig, SourceSearchOutcome } from '@/lib/types';

export const runtime = 'nodejs';

interface SearchBody {
  wd: string;
  context?: SearchContext;
  sources: SourceConfig[];
  filterAdult?: boolean;
}

/** 搜索结果短缓存：同一关键词 + 同一组源在 TTL 内直接返回（播放页返回搜索页等场景） */
const SEARCH_CACHE_TTL = 60 * 1000;

/** 缓存键：wd + 成人过滤 + 排序后的源地址集合（直接用完整字符串，避免哈希碰撞串缓存） */
function searchCacheKey(plan: SearchPlan, sources: SourceConfig[], filterAdult: boolean): string {
  return `work-search:v1:${JSON.stringify([plan.query, plan.context, plan.titles, sources, filterAdult])}`;
}

async function runSources(sources: SourceConfig[], plan: SearchPlan, filterAdult: boolean, signal: AbortSignal,
  onSource?: (outcome: SourceSearchOutcome) => void, onProgress?: (outcome: SourceSearchOutcome) => void) {
  const outcomes: SourceSearchOutcome[] = new Array(sources.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(6, sources.length) }, async () => {
    while (next < sources.length && !signal.aborted) {
      const i = next++;
      const outcome = await searchWorkSource(sources[i], plan, { signal, filterAdult, onProgress });
      outcomes[i] = outcome;
      onSource?.(outcome);
    }
  }));
  signal.throwIfAborted();
  return outcomes;
}

/** 合并 + 去重 + 过滤 + 排序，stream 与非 stream 两种模式共用 */
function aggregateOutcomes(outcomes: SourceSearchOutcome[], plan: SearchPlan, filterAdult: boolean): SearchResponse {
  const list = prepareWorkSearchResults(outcomes.flatMap((o) => o.list), plan, filterAdult);

  const failures = outcomes
    .filter((o) => !o.ok || o.partial)
    .map((o) => ({ sourceKey: o.sourceKey, error: o.error || '请求失败', timedOut: o.timedOut, partial: o.partial }));

  return { list, failures };
}

/**
 * 服务端聚合搜索：
 * - 默认返回完整 JSON（换源流程使用）；
 * - `?stream=1` 以 NDJSON 逐源推送（完成一个推一条，健康源的结果不再等坏源超时），
 *   最终推送聚合后的 done 事件并写入短缓存。
 */
export async function POST(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  let body: SearchBody;
  try {
    body = (await req.json()) as SearchBody;
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
  }

  const wd = typeof body?.wd === 'string' ? body.wd.trim() : '';
  if (!wd || wd.length > 100) {
    return NextResponse.json({ error: '搜索关键词无效' }, { status: 400 });
  }
  if (!Array.isArray(body.sources) || body.sources.length === 0) {
    return NextResponse.json({ error: '请至少选择一个点播源' }, { status: 400 });
  }
  if (body.sources.some(s => !s || typeof s.key !== 'string' || typeof s.name !== 'string' || typeof s.url !== 'string'
    || s.key.length > 100 || s.name.length > 200 || s.url.length > 2048)) {
    return NextResponse.json({ error: '点播源配置无效' }, { status: 400 });
  }
  const context = readSearchContext(body.context);
  if (!context) return NextResponse.json({ error: '作品搜索条件无效' }, { status: 400 });
  const plan = buildSearchPlan(wd, context);
  const sources = [...new Map(body.sources.slice(0, 50).map(s => [s.key, s])).values()];
  const filterAdult = body.filterAdult !== false;

  const cacheKey = searchCacheKey(plan, sources, filterAdult);
  const cached = getCache<SearchResponse>(cacheKey);
  if (cached) {
    // 流式模式下缓存命中也要走 done 事件，客户端解析逻辑保持单一
    if (new URL(req.url).searchParams.get('stream') === '1') {
      const event: SearchStreamEvent = { type: 'done', list: cached.list, failures: cached.failures };
      return new Response(JSON.stringify(event) + '\n', {
        headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
    return NextResponse.json(cached);
  }

  const isStream = new URL(req.url).searchParams.get('stream') === '1';
  if (!isStream) {
    const outcomes = await runSources(sources, plan, filterAdult, req.signal);
    const payload = aggregateOutcomes(outcomes, plan, filterAdult);
    if (!payload.failures.length) setCache(cacheKey, payload, SEARCH_CACHE_TTL);
    return NextResponse.json(payload);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: SearchStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
        } catch {
          closed = true; // 客户端已断开
        }
      };

      let outcomes: SourceSearchOutcome[];
      try {
        outcomes = await runSources(sources, plan, filterAdult, req.signal,
          outcome => send({ type: 'source', ...outcome }),
          outcome => send({ type: 'progress', ...outcome }));
      } catch {
        closed = true;
        try { controller.close(); } catch { /* client disconnected */ }
        return;
      }

      const payload = aggregateOutcomes(outcomes, plan, filterAdult);
      if (!payload.failures.length) setCache(cacheKey, payload, SEARCH_CACHE_TTL);
      send({ type: 'done', list: payload.list, failures: payload.failures });
      closed = true;
      try {
        controller.close();
      } catch { /* 已断开 */ }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
}

import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { readWork } from '@/lib/recommendations';
import { matchWorkSources } from '@/lib/recommendation-resources';
import type { SourceConfig } from '@/lib/types';

export const runtime = 'nodejs';
const respond = (data: object, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
export async function POST(req: Request) {
  const guarded = guardRequest(req); if (guarded) return guarded;
  let work: ReturnType<typeof readWork>;
  const sources: SourceConfig[] = [];
  let filterAdult = true, includeMetadata = false;
  try {
    const raw = await req.text();
    if (raw.length > 32000) return respond({ error: '查询参数过长' }, 400);
    const body = JSON.parse(raw);
    work = readWork(body?.work);
    filterAdult = body?.filterAdult !== false;
    includeMetadata = body?.includeMetadata === true;
    if (!work || !Array.isArray(body.sources) || !body.sources.length || body.sources.length > 6) return respond({ error: '影片或源列表无效' }, 400);
    const seen = new Set<string>(), keys = new Set<string>();
    for (const value of body.sources) {
      if (!value || typeof value.key !== 'string' || !value.key || value.key.length > 200
        || typeof value.name !== 'string' || value.name.length > 200 || typeof value.url !== 'string'
        || value.url.length > 2048 || !/^https?:\/\//.test(value.url)) return respond({ error: '点播源无效' }, 400);
      const url = new URL(value.url);
      if (url.username || url.password) return respond({ error: '点播源无效' }, 400);
      if (seen.has(url.href)) continue;
      if (keys.has(value.key)) return respond({ error: '点播源编号重复' }, 400);
      seen.add(url.href); keys.add(value.key);
      sources.push({ key: value.key, name: value.name, url: url.href, isAdult: value.isAdult === true });
    }
  } catch {
    return respond({ error: '查询参数无效' }, 400);
  }
  try {
    const result = await matchWorkSources(work, sources, filterAdult, AbortSignal.any([req.signal, AbortSignal.timeout(25000)]), includeMetadata);
    return respond(result);
  } catch {
    return respond({ error: '资源查询未完成，请重试' }, 502);
  }
}

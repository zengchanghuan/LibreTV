import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { deepSeekConfigured, deepSeekRecommendations } from '@/lib/deepseek-recommendations';
import { localRecommendations, recommendationCatalog } from '@/lib/recommendation-catalog';
import { rankWorks, type RecommendationResponse } from '@/lib/recommendations';
import type { VideoInfo } from '@/lib/types';

export const runtime = 'nodejs';
const respond = (data: object, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(req: Request) {
  const guarded = guardRequest(req); if (guarded) return guarded;
  let body: { seed?: Partial<VideoInfo>; filterAdult?: boolean; mode?: 'local' | 'auto' };
  try {
    const raw = await req.text();
    if (raw.length > 12000) return respond({ error: '影片资料过长' }, 400);
    body = JSON.parse(raw);
    if (!body || typeof body !== 'object' || !body.seed || typeof body.seed !== 'object') throw new Error();
    if (body.mode !== undefined && !['local', 'auto'].includes(body.mode)) throw new Error();
  } catch { return respond({ error: '影片资料无效' }, 400); }
  const raw = body.seed;
  if (typeof raw.title !== 'string' || !raw.title.trim() || raw.title.length > 100
    || (raw.year !== undefined && (typeof raw.year !== 'string' || !/^(?:18|19|20)\d{2}$/.test(raw.year)))) return respond({ error: '片名或年份无效' }, 400);
  const clean = (v: unknown, limit: number) => typeof v === 'string' ? v.slice(0, limit) : undefined;
  const info: VideoInfo = { title: raw.title.trim(), year: raw.year, typeName: clean(raw.typeName, 200),
    director: clean(raw.director, 300), actor: clean(raw.actor, 500), sourceKey: '', sourceName: '' };
  const filterAdult = body.filterAdult !== false;
  const { seed } = localRecommendations(info);
  const local = rankWorks(seed, recommendationCatalog, filterAdult);
  const aiAvailable = deepSeekConfigured() && /^(18|19|20)\d{2}$/.test(seed.year);
  if (body.mode === 'local' || !aiAvailable) return respond({ items: local, provider: 'local', aiAvailable } satisfies RecommendationResponse);
  try {
    const ai = await deepSeekRecommendations(seed, filterAdult, req.signal);
    return respond({ items: rankWorks(seed, [...ai, ...recommendationCatalog], filterAdult), provider: 'deepseek' } satisfies RecommendationResponse);
  } catch {
    // A failed provider must not empty an already useful local list or poison the cache.
    return respond({ items: local, provider: 'local', partial: true } satisfies RecommendationResponse);
  }
}

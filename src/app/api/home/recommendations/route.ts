import { after, NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { readHomeRecommendations, warmHomeRecommendations } from '@/lib/home-recommendation-service';
import { accountIdFromCookie } from '@/lib/auth';
import { readHomeFeedback } from '@/lib/home-feedback';
import { buildHomeRecommendations } from '@/lib/home-recommendations';

export const runtime = 'nodejs';
export const maxDuration = 90;

export async function GET(req: Request) {
  const guarded = guardRequest(req); if (guarded) return guarded;
  const value = new URL(req.url).searchParams.get('filterAdult');
  if (value !== null && value !== 'true' && value !== 'false') return NextResponse.json({ error: '内容过滤参数无效' }, { status: 400 });
  const filter = value !== 'false';
  try {
    const [data, preferences] = await Promise.all([
      readHomeRecommendations(filter), readHomeFeedback(accountIdFromCookie(req.headers.get('cookie'))),
    ]);
    if (data.aiStatus === 'pending') after(() => warmHomeRecommendations(filter));
    // Personalization stays outside the shared daily/AI cache and never leaves this server.
    const result = preferences.length ? { ...buildHomeRecommendations(filter,
      data.batches.flat().filter(work => work.origin === 'ai'), Date.now(), preferences), aiStatus: data.aiStatus } : data;
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ error: '推荐暂时无法读取，请重试' }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } });
  }
}

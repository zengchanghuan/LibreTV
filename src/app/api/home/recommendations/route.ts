import { after, NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { readHomeRecommendations, warmHomeRecommendations } from '@/lib/home-recommendation-service';

export const runtime = 'nodejs';
export const maxDuration = 90;

export async function GET(req: Request) {
  const guarded = guardRequest(req); if (guarded) return guarded;
  const value = new URL(req.url).searchParams.get('filterAdult');
  if (value !== null && value !== 'true' && value !== 'false') return NextResponse.json({ error: '内容过滤参数无效' }, { status: 400 });
  const filter = value !== 'false';
  const data = await readHomeRecommendations(filter);
  if (data.aiStatus === 'pending') after(() => warmHomeRecommendations(filter));
  return NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } });
}

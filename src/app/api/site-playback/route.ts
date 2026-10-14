import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { resolveSitePlayback, validSiteId } from '@/lib/site-adapters/site-adapters';
export const runtime = 'nodejs';
export async function GET(req: Request) {
  const denied = guardRequest(req); if (denied) return denied;
  const params = new URL(req.url).searchParams, site = params.get('site'), id = params.get('id') || '';
  if ((site !== '4kvm' && site !== 'baipiaozhe') || !validSiteId(id))
    return NextResponse.json({ error: '无效的网站或剧集编号' }, { status: 400 });
  try {
    const media = await resolveSitePlayback(site, id, AbortSignal.any([req.signal, AbortSignal.timeout(35000)]));
    return NextResponse.json(media, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '播放解析失败' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}

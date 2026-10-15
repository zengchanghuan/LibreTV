import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { hdResourceSite } from '@/lib/hd-resource-sites';
import { getResourcePage, resourcePageUrl } from '@/lib/hd-resource-catalog';
export const runtime = 'nodejs';
export async function GET(req: Request) {
  const denied = guardRequest(req); if (denied) return denied;
  const params = new URL(req.url).searchParams;
  const site = hdResourceSite(params.get('site'));
  const mode = params.get('mode') || 'catalog';
  if (!site || !['catalog', 'detail'].includes(mode)) return NextResponse.json({ error: '无效的资源网站' }, { status: 400 });
  const detail = mode === 'detail', url = params.get('url') || site.url;
  if (!resourcePageUrl(site.id, url, detail)) return NextResponse.json({ error: '无效的资源页面' }, { status: 400 });
  try {
    return NextResponse.json(await getResourcePage(site.id, url, detail, req.signal), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '资源目录暂不可用' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}

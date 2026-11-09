import { after, NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { readDiscovery, refreshDiscovery } from '@/lib/discovery-service';
import { readHomeFeedback } from '@/lib/home-feedback';
import { accountIdFromCookie } from '@/lib/auth';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  const guard = guardRequest(req); if (guard) return guard;
  const raw = new URL(req.url).searchParams.get('sources') || '';
  if (raw.length > 4000) return NextResponse.json({ error: '来源参数过长' }, { status: 400 });
  try {
    const preferences = await readHomeFeedback(accountIdFromCookie(req.headers.get('cookie')));
    const result = await readDiscovery(raw.split(',').slice(0, 100), Date.now(), preferences);
    after(() => refreshDiscovery().catch(() => {}));
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch { return NextResponse.json({ error: '首页内容暂不可用' }, { status: 503 }); }
}

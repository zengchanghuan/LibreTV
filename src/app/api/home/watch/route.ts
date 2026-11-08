import { accountIdFromCookie } from '@/lib/auth';
import { guardFamily, familyJson } from '@/lib/family-api';
import { resolveObservedWork } from '@/lib/discovery-service';
import { creditWatch, startWatch, watchActor, watchTransaction } from '@/lib/discovery-popularity';
export const runtime = 'nodejs';
const starts = new Map<string, number>();
const beats = new Map<string, number>();
export async function POST(req: Request) {
  const guard = guardFamily(req); if (guard) return guard;
  if (process.env.HOME_DISCOVERY_POPULAR === '0') return familyJson({ disabled: true });
  try {
    const reader = req.body?.getReader(); if (!reader) return familyJson({ error: '请求为空' }, 400);
    let text = '', bytes = 0; const decoder = new TextDecoder();
    try { for (;;) { const next = await reader.read(); if (next.done) break; bytes += next.value.length; if (bytes > 2048) return familyJson({ error: '请求过长' }, 413); text += decoder.decode(next.value, { stream: true }); } }
    finally { await reader.cancel().catch(() => {}); }
    const body = JSON.parse(text + decoder.decode());
    const actor = watchActor(accountIdFromCookie(req.headers.get('cookie'))), now = Date.now();
    if (body.action === 'start') {
      for (const [key, time] of starts) if (now - time > 60_000) starts.delete(key);
      if (now - (starts.get(actor) || 0) < 3000 || starts.size >= 10000) return familyJson({ error: '请求过于频繁' }, 429);
      starts.set(actor, now);
      if (typeof body.sourceKey !== 'string' || body.sourceKey.length > 100 || typeof body.vodId !== 'string' || !/^[\w-]{1,100}$/.test(body.vodId)) return familyJson({ error: '影片参数无效' }, 400);
      const work = await resolveObservedWork(body.sourceKey, body.vodId);
      if (!work) return familyJson({ disabled: true });
      const session = await watchTransaction(d => startWatch(d, actor, work.id, Date.now()), true);
      return familyJson({ session });
    }
    if (body.action !== 'heartbeat' || typeof body.session !== 'string' || !/^[a-f0-9-]{36}$/.test(body.session)
      || !Number.isSafeInteger(body.seq) || body.seq < 1 || !Number.isFinite(body.seconds) || body.seconds < 0 || body.seconds > 35
      || !Number.isFinite(body.duration) || body.duration < 0 || body.duration > 86400) return familyJson({ error: '观看事件无效' }, 400);
    for (const [key, time] of beats) if (now - time > 60000) beats.delete(key);
    if (now - (beats.get(actor) || 0) < 1500 || beats.size >= 10000) return familyJson({ error: '请求过于频繁' }, 429);
    beats.set(actor, now);
    return familyJson(await watchTransaction(d => creditWatch(d, actor, body.session, body.seq, body.seconds, body.duration, now), true));
  } catch { return familyJson({ error: '统计暂不可用' }, 400); }
}

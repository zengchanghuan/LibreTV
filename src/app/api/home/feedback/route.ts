import { accountIdFromCookie } from '@/lib/auth';
import { guardFamily, familyJson } from '@/lib/family-api';
import { publicHomeFeedback, readHomeFeedback, saveHomeFeedback } from '@/lib/home-feedback';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const guard = guardFamily(req); if (guard) return guard;
  try { return familyJson(publicHomeFeedback(await readHomeFeedback(accountIdFromCookie(req.headers.get('cookie'))))); }
  catch { return familyJson({ error: '喜好记录暂时无法读取' }, 503); }
}

export async function POST(req: Request) {
  const guard = guardFamily(req); if (guard) return guard;
  let body: unknown;
  try {
    const reader = req.body?.getReader(); if (!reader) return familyJson({ error: '请求为空' }, 400);
    let text = '', bytes = 0; const decoder = new TextDecoder();
    try {
      for (;;) {
        const chunk = await reader.read(); if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 2048) return familyJson({ error: '请求过长' }, 413);
        text += decoder.decode(chunk.value, { stream: true });
      }
    } finally { await reader.cancel().catch(() => {}); }
    body = JSON.parse(text + decoder.decode());
  } catch { return familyJson({ error: '反馈格式无效' }, 400); }
  if (!body || typeof body !== 'object') return familyJson({ error: '反馈格式无效' }, 400);
  const { workId, vote } = body as Record<string, unknown>;
  if (typeof workId !== 'string' || !workId || workId.length > 300
    || (vote !== 'like' && vote !== 'dislike' && vote !== null)) return familyJson({ error: '反馈参数无效' }, 400);
  try {
    const result = await saveHomeFeedback(accountIdFromCookie(req.headers.get('cookie')), workId, vote);
    return result ? familyJson(result) : familyJson({ error: '未找到这部影片，请刷新后重试' }, 404);
  } catch { return familyJson({ error: '保存失败，请重试' }, 503); }
}

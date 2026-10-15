import { NextResponse } from 'next/server';
import { guardRequest } from './api-guard';

export function guardFamily(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;
  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || req.headers.get('host') || new URL(req.url).host;
  let sameOrigin = true;
  try { if (origin) sameOrigin = new URL(origin).host === host; } catch { sameOrigin = false; }
  if (req.headers.get('sec-fetch-site') === 'cross-site' || !sameOrigin) return familyJson({ error: '不接受跨站同步请求' }, 403);
  if (req.method !== 'GET' && !req.headers.get('content-type')?.includes('application/json')) return familyJson({ error: '需要 JSON 请求' }, 415);
  return null;
}
export function familyJson(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store, private' } });
}
export async function readFamilyBody(req: Request) {
  const reader = req.body?.getReader();
  if (!reader) throw new Error('请求内容为空');
  let bytes = 0, text = '';
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 2 * 1024 * 1024) throw new Error('请求体积超出限制');
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally { await reader.cancel().catch(() => {}); }
  return JSON.parse(text + decoder.decode());
}

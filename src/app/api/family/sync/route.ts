import { accountIdFromCookie } from '@/lib/auth';
import { guardFamily, familyJson, readFamilyBody } from '@/lib/family-api';
import { syncProfile } from '@/lib/family-server';
import { parseMutations, validProfileId } from '@/lib/family-types';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const guard = guardFamily(req); if (guard) return guard;
  try {
    const body = await readFamilyBody(req);
    if (!validProfileId(body.profileId)) return familyJson({ error: '无效的家庭成员' }, 400);
    return familyJson(await syncProfile(body.profileId, parseMutations(body.mutations), accountIdFromCookie(req.headers.get('cookie'))));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code) return familyJson({ error: '同步暂时不可用，请检查服务器数据目录' }, 503);
    return familyJson({ error: error instanceof Error ? error.message : '同步失败' }, 400);
  }
}

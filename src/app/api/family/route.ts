import { guardFamily, familyJson, readFamilyBody } from '@/lib/family-api';
import { createProfile, listProfiles } from '@/lib/family-server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const guard = guardFamily(req); if (guard) return guard;
  try { return familyJson({ profiles: await listProfiles() }); }
  catch { return familyJson({ error: '家庭数据暂时不可用，请检查服务器数据目录' }, 503); }
}
export async function POST(req: Request) {
  const guard = guardFamily(req); if (guard) return guard;
  try {
    const body = await readFamilyBody(req);
    return familyJson({ profile: await createProfile(body.name, body.avatar) }, 201);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code) return familyJson({ error: '无法保存家庭数据，请检查服务器数据目录' }, 503);
    return familyJson({ error: error instanceof Error ? error.message : '创建失败' }, 400);
  }
}

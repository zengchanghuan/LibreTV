import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createProfile, listProfiles, syncProfile } from './family-server';
import { mergeFamily, parseMutations } from './family-types';
import { signSession, SESSION_COOKIE } from './auth';
import { POST } from '@/app/api/family/sync/route';
import { POST as create, GET as list } from '@/app/api/family/route';

let directory: string;
const originalDir = process.env.LIBRETV_DATA_DIR;
const originalPassword = process.env.PASSWORD;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'libretv-family-test-'));
  process.env.LIBRETV_DATA_DIR = directory; process.env.PASSWORD = 'family-test-password';
});
afterEach(async () => {
  if (originalDir === undefined) delete process.env.LIBRETV_DATA_DIR; else process.env.LIBRETV_DATA_DIR = originalDir;
  if (originalPassword === undefined) delete process.env.PASSWORD; else process.env.PASSWORD = originalPassword;
  await rm(directory, { recursive: true, force: true });
});
const history = { id: 'env_0_42', sourceKey: 'env_0', vodId: '42', title: '测试影片', episodeIndex: 2, totalEpisodes: 8, playbackPosition: 120, duration: 1800, timestamp: 1 };
const mutation = (baseRevision: number, value: unknown = history, mutationId = crypto.randomUUID()) => parseMutations([{ kind: 'history', key: history.id, value, baseRevision, mutationId }]);
function req(body: unknown, headers: Record<string, string> = {}, auth = true) {
  return new Request('https://tv.example/api/family/sync', { method: 'POST', headers: {
    'content-type': 'application/json', ...(auth ? { cookie: `${SESSION_COOKIE}=${signSession().token}` } : {}), ...headers,
  }, body: JSON.stringify(body) });
}

describe('persistent family history', () => {
  it('isolates profiles and persists through a fresh file read', async () => {
    const a = await createProfile('爸爸', '🐱'), b = await createProfile('妈妈', '🐼');
    const saved = await syncProfile(a.id, mutation(0));
    expect(saved.rows[0].value).toMatchObject({ playbackPosition: 120 });
    expect((await syncProfile(b.id, [])).rows).toEqual([]);
    expect(JSON.parse(await readFile(path.join(directory, 'family.json'), 'utf8')).states[a.id].revision).toBe(1);
    expect(await listProfiles()).toHaveLength(2);
  });
  it('serializes concurrent profile creation and independent record writes', async () => {
    await Promise.all(Array.from({ length: 8 }, (_, i) => createProfile(`成员${i}`, '🐱')));
    const profiles = await listProfiles(); expect(profiles).toHaveLength(8);
    const results = await Promise.all(profiles.map(p => syncProfile(p.id, mutation(0))));
    expect(results.every(result => result.rows.length === 1)).toBe(true);
  });
  it('does not resurrect deletions from an offline stale client or duplicate retry', async () => {
    const profile = await createProfile('我', '🐱');
    const first = await syncProfile(profile.id, mutation(0));
    const removed = await syncProfile(profile.id, mutation(first.revision, null));
    const stale = mutation(first.revision, { ...history, playbackPosition: 900 });
    const retried = await syncProfile(profile.id, stale);
    expect(retried.conflicts).toHaveLength(1);
    expect(retried.rows[0].value).toBeNull();
    expect(retried.revision).toBe(removed.revision);
  });
  it('accepts explicit replay after the client has seen the deletion', async () => {
    const p = await createProfile('我', '🐱');
    await syncProfile(p.id, mutation(0));
    await syncProfile(p.id, mutation(1, null));
    const replay = await syncProfile(p.id, mutation(2));
    expect(replay.accepted).toHaveLength(1);
    expect(replay.rows[0].value).not.toBeNull();
  });
  it('preserves deletion protection after bounded storage compaction', () => {
    const rows = Array.from({ length: 1001 }, (_, i) => ({ kind: 'history' as const, key: `k${i}`, value: null, revision: i + 1 }));
    const compacted = mergeFamily({ revision: 1001, floorRevision: 0, rows }, []);
    expect(compacted.rows).toHaveLength(0);
    expect(mergeFamily(compacted, mutation(0)).conflicts).toHaveLength(1);
  });
});

describe('family API boundary', () => {
  it('requires authentication and rejects cross-site writes', async () => {
    expect((await POST(req({}, {}, false))).status).toBe(401);
    expect((await POST(req({}, { origin: 'https://other.example' }))).status).toBe(403);
    expect((await POST(req({}, { origin: 'null' }))).status).toBe(403);
    expect((await POST(req({}, { 'content-type': 'text/plain' }))).status).toBe(415);
  });
  it('supports profile creation, listing and synchronization without cacheable responses', async () => {
    const created = await create(req({ name: '我', avatar: '🐱' }));
    expect(created.status).toBe(201);
    const { profile } = await created.json();
    const synced = await POST(req({ profileId: profile.id, mutations: mutation(0) }));
    expect(synced.status).toBe(200);
    expect(synced.headers.get('cache-control')).toContain('no-store');
    const listed = await list(new Request('https://tv.example/api/family', { headers: { cookie: `${SESSION_COOKIE}=${signSession().token}` } }));
    expect((await listed.json()).profiles).toHaveLength(1);
    expect((await POST(req({ profileId: '../escape', mutations: [] }))).status).toBe(400);
  });
  it('rejects poisoned batches, oversized strings and non-finite media values', async () => {
    const p = await createProfile('我', '🐱');
    for (const value of [{ ...history, duration: null }, { ...history, title: 'x'.repeat(513) }, { ...history, sourceUrl: 'file:///etc/passwd' }]) {
      const response = await POST(req({ profileId: p.id, mutations: [{ kind: 'history', key: history.id, mutationId: 'bad', baseRevision: 0, value }] }));
      expect(response.status).toBe(400);
    }
    expect((await syncProfile(p.id, [])).rows).toHaveLength(0);
  });
});

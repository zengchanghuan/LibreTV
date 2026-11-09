import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './route';
import { SESSION_COOKIE, signSession } from '@/lib/auth';
import { readAccounts, type Account } from '@/lib/accounts';
import { recommendationCatalog } from '@/lib/recommendation-catalog';
import { readHomeFeedback } from '@/lib/home-feedback';

vi.mock('@/lib/accounts', () => ({ readAccounts: vi.fn() }));
let directory: string;
const alice: Account = { id: 'alice', username: 'alice', sessionVersion: '1', salt: '', hash: '' };
const bob: Account = { ...alice, id: 'bob', username: 'bob' };
const work = recommendationCatalog[0];
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'home-feedback-route-test-'));
  vi.stubEnv('LIBRETV_DATA_DIR', directory); vi.stubEnv('PASSWORD', 'feedback-route-tests'); vi.stubEnv('PROXY_SECRET', '');
  vi.mocked(readAccounts).mockReturnValue([alice, bob]);
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });
function request(body?: unknown, account: Account | null = alice, headers: Record<string, string> = {}) {
  return new Request('https://app.example/api/home/feedback', {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(account ? { cookie: `${SESSION_COOKIE}=${signSession(account).token}` } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
describe('home feedback endpoint', () => {
  it('authenticates reads and writes and rejects cross-origin mutation', async () => {
    expect((await GET(request(undefined, null))).status).toBe(401);
    expect((await POST(request({}, null))).status).toBe(401);
    expect((await POST(request({}, alice, { origin: 'https://other.example' }))).status).toBe(403);
    expect((await POST(request({}, alice, { 'sec-fetch-site': 'cross-site' }))).status).toBe(403);
    expect((await POST(request({}, alice, { 'Content-Type': 'text/plain' }))).status).toBe(415);
  });
  it('validates bounded input, rejects forged IDs and never trusts submitted metadata or account IDs', async () => {
    expect((await POST(request({ fill: 'x'.repeat(2200) }))).status).toBe(413);
    for (const body of [null, {}, { workId: work.id }, { workId: work.id, vote: 'invalid' }, { workId: 42, vote: 'like' }]) {
      expect((await POST(request(body))).status).toBe(400);
    }
    expect((await POST(request({ workId: 'forged', vote: 'like' }))).status).toBe(404);
    expect((await POST(request({ workId: work.id, vote: 'like', accountId: 'bob', title: 'forged', directors: ['forged'] }))).status).toBe(200);
    const saved = await readHomeFeedback('alice');
    expect(saved[0].work.title).toBe(work.title); expect(saved[0].work.directors).toEqual(work.directors);
    expect(await readHomeFeedback('bob')).toEqual([]);
  });
  it('returns only the signed-in account’s state and supports switching and undo', async () => {
    await POST(request({ workId: work.id, vote: 'like' }));
    const result = await GET(request());
    expect(result.headers.get('cache-control')).toBe('no-store, private');
    expect(await result.json()).toMatchObject({ items: [{ workId: work.id, vote: 'like' }] });
    expect(await (await GET(request(undefined, bob))).json()).toEqual({ items: [] });
    await POST(request({ workId: work.id, vote: 'dislike' }));
    expect(await (await GET(request())).json()).toMatchObject({ items: [{ vote: 'dislike' }] });
    await POST(request({ workId: work.id, vote: null }));
    expect(await (await GET(request())).json()).toEqual({ items: [] });
  });
  it('reports storage failures instead of acknowledging a vote that was not saved', async () => {
    await POST(request({ workId: work.id, vote: 'like' }));
    const file = (await readdir(join(directory, 'discovery'))).find(name => name.startsWith('feedback-'))!;
    await writeFile(join(directory, 'discovery', file), 'invalid JSON');
    expect((await GET(request())).status).toBe(503);
    expect((await POST(request({ workId: work.id, vote: 'dislike' }))).status).toBe(503);
  });
});

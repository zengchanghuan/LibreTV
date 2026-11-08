import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import { signSession, SESSION_COOKIE } from '@/lib/auth';
import { resolveObservedWork } from '@/lib/discovery-service';
import { emptyWatchState } from '@/lib/discovery-popularity';
const mocked = vi.hoisted(() => ({ state: undefined as unknown }));
vi.mock('@/lib/discovery-service', () => ({ resolveObservedWork: vi.fn() }));
vi.mock('@/lib/discovery-popularity', async original => ({ ...await original<typeof import('@/lib/discovery-popularity')>(), watchTransaction: vi.fn(fn => fn(mocked.state)) }));
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('PASSWORD', 'watch-test-only'); mocked.state = emptyWatchState(); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
function request(body: unknown, auth = true, extra: Record<string, string> = {}) {
  return new Request('https://app.example/api/home/watch', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { cookie: `${SESSION_COOKIE}=${signSession().token}` } : {}), ...extra }, body: JSON.stringify(body) });
}
describe('watch endpoint', () => {
  it('requires authentication and same origin before resolving a resource', async () => {
    expect((await POST(request({}, false))).status).toBe(401);
    expect((await POST(request({}, true, { origin: 'https://other.example' }))).status).toBe(403);
    expect(resolveObservedWork).not.toHaveBeenCalled();
  });
  it('bounds body size and rejects malformed heartbeats', async () => {
    expect((await POST(request({ fill: 'x'.repeat(2200) }))).status).toBe(413);
    for (const value of [null, {}, { action: 'heartbeat', session: 'bad', seq: 1, seconds: 300 }]) expect((await POST(request(value))).status).toBe(400);
  });
  it('honors the feature switch before source lookups', async () => {
    vi.stubEnv('HOME_DISCOVERY_POPULAR', '0');
    expect(await (await POST(request({ action: 'start', sourceKey: 'env_0', vodId: '1' }))).json()).toEqual({ disabled: true });
    expect(resolveObservedWork).not.toHaveBeenCalled();
  });
  it('starts only with a server-resolved work and never trusts a client supplied title', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-08T12:00:00Z'));
    vi.mocked(resolveObservedWork).mockResolvedValue({ id: 'verified-work', title: 'verified', year: '2026', aliases: [], genres: [], directors: [], cast: [], reasons: [], origin: 'source', mediaType: 'movie', score: 0 });
    const result = await POST(request({ action: 'start', sourceKey: 'env_0', vodId: '1', workId: 'forged' }));
    expect(result.status).toBe(200);
    expect((mocked.state as ReturnType<typeof emptyWatchState>).sessions[0].workId).toBe('verified-work');
  });
});

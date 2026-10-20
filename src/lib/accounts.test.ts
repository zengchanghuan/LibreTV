import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID, scryptSync } from 'node:crypto';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { checkAccount, type Account } from './accounts';
import { signSession, verifySession, accountIdFromCookie } from './auth';
import { POST } from '@/app/api/auth/route';
import { createProfile, listProfiles, syncProfile } from './family-server';
let directory: string;
let account: Account;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'hometv-accounts-'));
  vi.stubEnv('LIBRETV_DATA_DIR', directory);
  vi.stubEnv('PASSWORD', 'original-owner-password');
  account = { id: randomUUID(), username: 'bruce', salt: 'ab'.repeat(16), hash: scryptSync('034567', 'ab'.repeat(16), 64).toString('hex'), sessionVersion: 'cd'.repeat(16) };
  await writeFile(path.join(directory, 'accounts.json'), JSON.stringify({ version: 1, accounts: [account] }));
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });
function login(body: unknown, ip = randomUUID()) {
  return POST(new Request('https://tv.example/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-real-ip': ip }, body: JSON.stringify(body) }));
}
describe('independent accounts and legacy compatibility', () => {
  it('accepts leading-zero passwords and rejects wrong or missing accounts', async () => {
    expect((await checkAccount('bruce', '034567'))?.id).toBe(account.id);
    expect(await checkAccount('bruce', '34567')).toBeNull();
    expect(await checkAccount('unknown', '034567')).toBeNull();
  });
  it('keeps original sessions valid while binding new sessions to an active account', async () => {
    const old = signSession().token;
    const token = signSession(account).token;
    expect(verifySession(old)).toBe(true);
    expect(verifySession(token)).toBe(true);
    expect(accountIdFromCookie(`ltv_session=${token}`)).toBe(account.id);
    expect(verifySession(token.replace(account.id, randomUUID()))).toBe(false);
    await writeFile(path.join(directory, 'accounts.json'), JSON.stringify({ version: 1, accounts: [] }));
    expect(verifySession(token)).toBe(false);
    expect(verifySession(old)).toBe(true);
  });
  it('supports both login paths without allowing cross-credential fallback', async () => {
    const old = await login({ password: 'original-owner-password' });
    expect(old.status).toBe(200);
    expect((await old.json()).accountId).toBeNull();
    const response = await login({ username: 'Bruce', password: '034567' });
    expect(response.status).toBe(200);
    expect((await response.json()).accountId).toBe(account.id);
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect((await login({ username: 'bruce', password: 'original-owner-password' })).status).toBe(401);
    expect((await login({ password: '034567' })).status).toBe(401);
  });
  it('limits guessing one account even across different IPs', async () => {
    for (let i = 0; i < 10; i++) expect((await login({ username: 'nobody', password: 'bad' })).status).toBe(401);
    expect((await login({ username: 'nobody', password: 'bad' })).status).toBe(429);
  });
  it('rejects cross-site login and malformed passwords', async () => {
    expect((await POST(new Request('https://tv.example/api/auth', { method: 'POST', headers: { origin: 'https://evil.example' }, body: '{}' }))).status).toBe(403);
    expect((await login({ password: {} })).status).toBe(400);
  });
  it('isolates family records and rejects access to an owner profile', async () => {
    const owner = await createProfile('Owner', '🐱');
    const friend = await createProfile('Bruce', '🐻', account.id);
    expect(await listProfiles()).toEqual([owner]);
    expect(await listProfiles(account.id)).toEqual([friend]);
    await expect(syncProfile(owner.id, [], account.id)).rejects.toThrow('家庭成员不存在');
    await expect(syncProfile(friend.id, [])).rejects.toThrow('家庭成员不存在');
  });
});

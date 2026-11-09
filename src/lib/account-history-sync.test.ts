import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mergeFamily, parseMutations, type FamilySnapshot } from './family-types';

const account = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const otherAccount = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const history = { id: 'env_0_42', sourceKey: 'env_0', vodId: '42', title: '测试影片', pic: '/film-posters/test.jpg',
  episodeIndex: 0, totalEpisodes: 2, playbackPosition: 120, duration: 1800, timestamp: 100 };
let server: Map<string, FamilySnapshot>;
let databases: (typeof import('./db'))['db'][];
let requests: { scope: string; accountId: string; mutations: unknown[] }[];

async function device(name: string, id = account) {
  vi.resetModules();
  vi.doMock('./account-client', () => ({ activeAccountId: id, readAccountId: () => id, localDatabaseName: `account-history-test-${name}-${id}` }));
  const local = await import('./db');
  databases.push(local.db);
  return { ...local, sync: (await import('./family-sync')).syncFamily };
}

beforeEach(() => {
  server = new Map(); databases = []; requests = [];
  vi.stubGlobal('localStorage', { getItem: () => null });
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
    const body = JSON.parse(options.body); requests.push(body);
    const snapshot = server.get(body.accountId) || { revision: 0, floorRevision: 0, rows: [] };
    const result = mergeFamily(snapshot, parseMutations(body.mutations));
    server.set(body.accountId, result); return Response.json(result);
  }));
});
afterEach(async () => {
  await Promise.all(databases.map(db => db.delete()));
  vi.doUnmock('./account-client'); vi.unstubAllGlobals();
});

describe('automatic account history across browsers', () => {
  it('imports both Macs without selecting a member, retains backups, and synchronizes subsequent progress', async () => {
    const macA = await device('mac-a'), macB = await device('mac-b');
    expect(macA.activeProfileId).toBeNull(); expect(macA.accountHistorySync).toBe(true);
    await macA.db.history.put(history);
    await macA.db.progress.put({ key: 'env_0_42_0', position: 120, duration: 1800, updatedAt: 100 });
    await macB.db.history.put({ ...history, id: 'env_0_43', vodId: '43', title: '另一部影片', timestamp: 200 });
    await macA.sync(); await macB.sync(); await macA.sync();
    expect(requests.every(r => r.scope === 'account' && r.accountId === account)).toBe(true);
    expect(await macA.db.history.count()).toBe(2); expect(await macB.db.history.count()).toBe(2);
    expect(await macA.db.syncBackup.count()).toBe(2);
    await macA.updateHistoryProgress('env_0', '42', 600, 1800, 0);
    await macA.saveProgress('env_0', '42', 0, 600, 1800);
    await macA.sync(); await macB.sync();
    expect((await macB.db.history.get(history.id))?.playbackPosition).toBe(600);
    expect((await macB.db.progress.get('env_0_42_0'))?.position).toBe(600);
    expect((await macA.db.syncBackup.get(`history:${history.id}`))?.value).toMatchObject({ playbackPosition: 120 });
    const revision = server.get(account)!.revision;
    await macA.sync(); expect(server.get(account)!.revision).toBe(revision);
  });

  it('keeps migration pending offline and retries without losing the original records', async () => {
    const mac = await device('offline'); await mac.db.history.put(history);
    const online = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(mac.sync()).rejects.toThrow('offline');
    expect(await mac.db.history.count()).toBe(1); expect(await mac.db.syncBackup.count()).toBe(1);
    expect(await mac.db.syncOutbox.count()).toBe(1);
    vi.stubGlobal('fetch', online); await mac.sync();
    expect(await mac.db.syncOutbox.count()).toBe(0); expect(server.get(account)!.rows).toHaveLength(1);
  });

  it('does not reintroduce deletions or overwrite newer cloud progress with an old device import', async () => {
    const macA = await device('a'), macB = await device('b');
    await macA.db.history.put(history); await macA.sync();
    await macA.updateHistoryProgress('env_0', '42', 600, 1800, 0); await macA.sync();
    await macB.db.history.put({ ...history, timestamp: 200 }); await macB.sync();
    expect((await macB.db.history.get(history.id))?.playbackPosition).toBe(600);
    await macA.removeHistory('env_0', '42'); await macA.sync();
    const oldMac = await device('old'); await oldMac.db.history.put({ ...history, timestamp: Date.now() });
    await oldMac.sync(); expect(await oldMac.db.history.count()).toBe(0);
    expect(await oldMac.db.syncBackup.count()).toBe(1);
  });

  it('chooses the more recent pre-sync device record and preserves its original timestamp', async () => {
    const macA = await device('first'), macB = await device('second');
    await macA.db.history.put(history); await macA.sync();
    await macB.db.history.put({ ...history, playbackPosition: 240, timestamp: 200 }); await macB.sync(); await macA.sync();
    expect(await macA.db.history.get(history.id)).toMatchObject({ playbackPosition: 240, timestamp: 200 });
  });

  it('drains imports larger than a single API batch and isolates different accounts', async () => {
    const mac = await device('large'); await mac.db.history.put(history);
    await mac.db.progress.bulkPut(Array.from({ length: 450 }, (_, i) => ({ key: `progress-${i}`, position: 120, duration: 1800, updatedAt: 100 })));
    expect(await mac.sync()).toMatchObject({ pending: 0 });
    expect(requests.map(r => r.mutations.length)).toEqual([400, 51]);
    expect(server.get(account)!.rows).toHaveLength(451);
    const different = await device('different', otherAccount); await different.sync();
    expect(await different.db.history.count()).toBe(0); expect(await different.db.progress.count()).toBe(0);
  });

  it('backs up malformed legacy rows without blocking valid history', async () => {
    const mac = await device('invalid');
    await mac.db.history.bulkPut([history, { ...history, id: 'env_0_bad', vodId: 'bad', title: '' }]);
    expect(await mac.sync()).toMatchObject({ skipped: 1, pending: 0 });
    expect(await mac.db.syncBackup.count()).toBe(2);
    expect(server.get(account)!.rows).toHaveLength(1);
  });
});

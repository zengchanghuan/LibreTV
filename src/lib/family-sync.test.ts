import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mergeFamily, parseMutations, type FamilySnapshot } from './family-types';

type DatabaseModule = typeof import('./db');
let local: DatabaseModule;
let synchronize: typeof import('./family-sync').syncFamily;
let server: FamilySnapshot;
const profileA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const profileB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const entry = { sourceKey: 'env_0', vodId: '42', title: '测试影片', episodeIndex: 0, totalEpisodes: 3, playbackPosition: 120, duration: 1800, timestamp: 1 };
beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('localStorage', { getItem: () => profileA });
  vi.stubGlobal('window', new EventTarget());
  local = await import('./db');
  synchronize = (await import('./family-sync')).syncFamily;
  server = { revision: 0, floorRevision: 0, rows: [] };
  vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
    const { mutations } = JSON.parse(options.body);
    const result = mergeFamily(server, parseMutations(mutations)); server = result;
    return Response.json(result);
  }));
});
afterEach(async () => { await local.db.delete(); vi.unstubAllGlobals(); });

describe('IndexedDB synchronization', () => {
  it('ignores a delayed snapshot after another tab has applied a newer revision', async () => {
    await local.upsertHistory(entry);
    let reply!: (response: Response) => void;
    let sent: unknown;
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      sent = JSON.parse(options.body).mutations;
      return new Promise<Response>(resolve => { reply = resolve; });
    }));
    const pending = synchronize();
    await vi.waitFor(() => expect(sent).toBeDefined());
    const oldSnapshot = mergeFamily(server, parseMutations(sent));
    await local.db.history.update('env_0_42', { playbackPosition: 600 });
    await local.db.syncMeta.put({ key: 'revision', value: oldSnapshot.revision + 1 });
    reply(Response.json(oldSnapshot)); await pending;
    expect((await local.db.history.get('env_0_42'))?.playbackPosition).toBe(600);
    expect((await local.db.syncMeta.get('revision'))?.value).toBe(oldSnapshot.revision + 1);
    expect(await local.db.syncOutbox.count()).toBe(1);
  });
  it('keeps edits made while an upload is in flight and rebases only its own accepted write', async () => {
    await local.upsertHistory(entry);
    let reply!: (response: Response) => void;
    let sent: unknown;
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      sent = JSON.parse(options.body).mutations;
      return new Promise<Response>(resolve => { reply = resolve; });
    }));
    const pending = synchronize();
    await vi.waitFor(() => expect(sent).toBeDefined());
    await local.updateHistoryProgress('env_0', '42', 240, 1800, 0);
    const response = mergeFamily(server, parseMutations(sent)); server = response;
    reply(Response.json(response)); await pending;
    expect((await local.db.history.get('env_0_42'))?.playbackPosition).toBe(240);
    const outbox = await local.db.syncOutbox.toArray();
    expect(outbox).toHaveLength(1); expect(outbox[0].baseRevision).toBe(1);
    expect(mergeFamily(server, outbox).conflicts).toHaveLength(0);
  });
  it('retains a deletion offline and clears it from both devices after retry', async () => {
    await local.upsertHistory(entry); await synchronize();
    await local.removeHistory('env_0', '42');
    const request = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(synchronize()).rejects.toThrow('offline');
    expect(await local.db.syncOutbox.count()).toBe(1);
    vi.stubGlobal('fetch', request); await synchronize();
    expect(await local.db.history.count()).toBe(0);
    expect(server.rows[0].value).toBeNull();
    expect(await local.db.syncOutbox.count()).toBe(0);
  });
  it('does not carry the previous episode position into a newly selected episode', async () => {
    await local.upsertHistory(entry);
    await local.upsertHistory({ ...entry, episodeIndex: 1, playbackPosition: 0, duration: 0 });
    await local.updateHistoryProgress('env_0', '42', 500, 1800, 0);
    expect(await local.db.history.get('env_0_42')).toMatchObject({ episodeIndex: 1, playbackPosition: 0 });
  });
  it('keeps different members in different databases', async () => {
    await local.upsertHistory(entry);
    vi.resetModules();
    vi.stubGlobal('localStorage', { getItem: () => profileB });
    const other = await import('./db');
    expect(await other.db.history.count()).toBe(0);
    await other.upsertHistory({ ...entry, playbackPosition: 600 });
    expect((await local.db.history.get('env_0_42'))?.playbackPosition).toBe(120);
    await other.db.delete();
  });
  it('clears history and per-episode progress using durable deletion markers', async () => {
    await local.upsertHistory(entry);
    await local.saveProgress('env_0', '42', 0, 120, 1800); await synchronize();
    await local.clearAllHistory(); await synchronize();
    expect(await local.db.progress.count()).toBe(0);
    expect(server.rows.every(row => row.value === null)).toBe(true);
  });
});

describe('native progress delivery', () => {
  const native = () => ({ eventId: 'n1', sessionId: 'session', profileId: profileA, sourceKey: 'env_0', vodId: '42', title: '原生测试', index: 0, total: 3, position: 120, duration: 1800, sequence: 1, baseRevision: 0, openedAt: Date.now() + 1000, ended: false, reason: 'progress' });
  it('deduplicates replay and rejects an older callback for the same episode', async () => {
    await local.recordNativeProgress(native());
    await local.recordNativeProgress({ ...native(), eventId: 'n2', sequence: 2, position: 240 });
    await local.recordNativeProgress(native());
    expect((await local.db.history.get('env_0_42'))?.playbackPosition).toBe(240);
    expect((await local.db.progress.get('env_0_42_0'))?.position).toBe(240);
    await synchronize(); expect(await local.db.syncOutbox.count()).toBe(0);
  });
  it('does not apply a callback to another household member', async () => {
    await local.recordNativeProgress({ ...native(), profileId: profileB });
    expect(await local.db.history.count()).toBe(0);
  });
  it('does not resurrect deleted history with a pre-restart native queue', async () => {
    await local.upsertHistory(entry); await synchronize(); await local.removeHistory('env_0', '42'); await synchronize();
    await local.recordNativeProgress({ ...native(), openedAt: 1 });
    expect(await local.db.history.count()).toBe(0);
  });
  it('keeps episodes independent and does not recreate finished progress on close', async () => {
    await local.recordNativeProgress(native());
    await local.recordNativeProgress({ ...native(), index: 1, position: 50, sequence: 2 });
    expect((await local.db.progress.get('env_0_42_0'))?.position).toBe(120);
    await local.recordNativeProgress({ ...native(), index: 1, position: 1800, ended: true, reason: 'close', sequence: 3 });
    expect(await local.db.progress.get('env_0_42_1')).toBeUndefined();
  });
  it('keeps the newer episode selected when an older episode callback arrives late', async () => {
    const session = native();
    await local.recordNativeProgress({ ...session, index: 1, sequence: 5, position: 30 });
    await local.recordNativeProgress({ ...session, index: 0, sequence: 4, position: 400 });
    expect((await local.db.history.get('env_0_42'))?.episodeIndex).toBe(1);
    expect((await local.db.progress.get('env_0_42_0'))?.position).toBe(400);
  });
  it('rejects delayed callbacks from an older playback session', async () => {
    const old = native();
    await local.recordNativeProgress({ ...old, sessionId: 'new', openedAt: old.openedAt + 100, position: 40 });
    expect(await local.recordNativeProgress({ ...old, sequence: 100, position: 600 })).toBe(false);
    expect((await local.db.progress.get('env_0_42_0'))?.position).toBe(40);
  });
  it('preserves known duration while the same episode loads', async () => {
    const session = native();
    await local.recordNativeProgress(session);
    await local.recordNativeProgress({ ...session, duration: 0, sequence: 2, reason: 'episode' });
    expect((await local.db.progress.get('env_0_42_0'))?.duration).toBe(1800);
  });
});

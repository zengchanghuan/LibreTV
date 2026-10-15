import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isSettingsFormat } from './settings-format';

type DatabaseModule = typeof import('./db');
let database: DatabaseModule;
let storage: Map<string, string>;

beforeEach(async () => {
  vi.resetModules();
  storage = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  database = await import('./db');
});
afterEach(async () => { await database.db.delete(); vi.unstubAllGlobals(); });

describe('HomeTV backup compatibility', () => {
  it.each(['LibreTV-Settings', 'HomeTV-Settings'])('imports %s backups using the existing storage', async name => {
    const settings = JSON.stringify({ state: { liveFavorites: ['https://example.com/channel.m3u8'] } });
    expect(isSettingsFormat(name)).toBe(true); // Same validation used by import preview.
    await database.importConfig(JSON.stringify({ name, data: { 'libretv-settings': settings } }));
    expect(storage.get('libretv-settings')).toBe(settings);
    expect(database.db.name).toBe('libretv');
  });
  it('exports HomeTV backups without losing existing settings or history', async () => {
    storage.set('libretv-settings', '{"state":{"theme":"dark"}}');
    const history = { id: 'source_video', sourceKey: 'source', vodId: 'video', title: '影片', episodeIndex: 1, totalEpisodes: 3, playbackPosition: 120, duration: 600, timestamp: 1 };
    await database.db.history.put(history);
    const backup = JSON.parse(await database.exportConfig());
    expect(backup.name).toBe('HomeTV-Settings');
    expect(backup.data['libretv-settings']).toBe(storage.get('libretv-settings'));
    expect(JSON.parse(backup.data.viewingHistory)).toEqual([history]);
  });
  it('rejects unrelated backup formats before modifying data', async () => {
    storage.set('libretv-settings', 'existing');
    expect(isSettingsFormat('Unrelated-Settings')).toBe(false);
    await expect(database.importConfig('{"name":"Unrelated-Settings","data":{"libretv-settings":"overwrite"}}')).rejects.toThrow('配置文件格式不正确');
    expect(storage.get('libretv-settings')).toBe('existing');
  });
});

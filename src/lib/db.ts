import { localDatabaseName } from './account-client';
import { SETTINGS_FORMAT, isSettingsFormat } from './settings-format';
import Dexie, { type EntityTable } from 'dexie';
import type { SourceConfig } from './types';
// 仅类型引入：store.ts 运行时会引用本模块，反向只取类型不会形成运行时循环
import type { LiveProbeEntry } from './store';
import { PERSIST_KEY, flushPendingPersist } from './persist-storage';
import { readProfileId, type SyncKind, type SyncMutation } from './family-types';
import type { NativeProgress } from './native-player';
const pageStartedAt = Date.now();

/**
 * IndexedDB 持久化（替代旧版 localStorage 数据库）：
 * - 观看历史不再冗余存储全集 URL 列表（旧版长剧 × 50 条极易撑爆 5MB 配额），
 *   只存定位信息（sourceKey+vodId+index），进入播放页时按需重新拉详情，
 *   顺带免费获得「剧集更新同步」能力。
 * - v2：直播测活缓存从 localStorage（随 zustand persist 整体重写）迁入独立表，
 *   高频写入不再拖累设置快照的序列化。
 */

export interface HistoryEntry {
  /** 主键：`${sourceKey}_${vodId}` */
  id: string;
  sourceKey: string;
  sourceUrl?: string;
  vodId: string;
  title: string;
  pic?: string;
  episodeIndex: number;
  totalEpisodes: number;
  playbackPosition: number;
  duration: number;
  timestamp: number;
}

export interface ProgressEntry {
  key: string; // `${sourceKey}_${vodId}_${episodeIndex}`
  position: number;
  duration: number;
  updatedAt: number;
}

export interface SearchHistoryEntry {
  text: string;
  timestamp: number;
}

export interface SegmentMetaEntry {
  /** Cache Storage 中的 key（归一化的分片绝对地址，或同源代理地址） */
  key: string;
  /** 所属剧集：`${source}:${vodId}:${episodeIndex}`，用于按集淘汰 */
  episodeKey: string;
  /** 片段序号（1 基，便于排查） */
  index: number;
  bytes: number;
  /** 预取时记录的真实耗时（毫秒），loader 命中缓存时合成进 hls.js stats 防 ABR 误判 */
  costMs: number;
  lastAccess: number;
}

export type DownloadStatus = 'waiting' | 'downloading' | 'paused' | 'completed' | 'error';

export interface DownloadTaskEntry {
  id: string;
  /** 播放页 m3u8 地址（直连或代理形式，入队时的原样） */
  url: string;
  title: string;
  /** 输出格式 */
  format: 'TS' | 'MP4';
  status: DownloadStatus;
  finished: number;
  total: number;
  errorNum: number;
  createdAt: number;
  updatedAt: number;
}

// A profile change reloads the page. Each open page keeps writing to its original profile.
export const activeProfileId = readProfileId();
export const db = new Dexie(activeProfileId ? `libretv-family-${activeProfileId}` : localDatabaseName) as Dexie & {
  history: EntityTable<HistoryEntry, 'id'>;
  progress: EntityTable<ProgressEntry, 'key'>;
  searchHistory: EntityTable<SearchHistoryEntry, 'text'>;
  liveProbe: EntityTable<LiveProbeEntry & { url: string }, 'url'>;
  segmentMeta: EntityTable<SegmentMetaEntry, 'key'>;
  downloads: EntityTable<DownloadTaskEntry, 'id'>;
  syncOutbox: EntityTable<SyncMutation, 'id'>;
  syncMeta: EntityTable<{ key: string; value: number }, 'key'>;
  nativeReceipts: EntityTable<{ key: string; sequence: number; receivedAt: number; openedAt?: number; sessionId?: string }, 'key'>;
};

db.version(1).stores({
  history: 'id, timestamp',
  progress: 'key, updatedAt',
  searchHistory: 'text, timestamp',
});

// v2 仅新增表；Dexie 会自动继承低版本的表结构
db.version(2).stores({
  liveProbe: 'url',
});

// v3：视频片段缓存元数据（Cache Storage 存字节、这里存 LRU 索引）与离线下载任务
db.version(3).stores({
  segmentMeta: 'key, episodeKey, lastAccess',
  downloads: 'id, createdAt',
});

db.version(4).stores({ syncOutbox: 'id', syncMeta: 'key' });
db.version(5).stores({ nativeReceipts: 'key, receivedAt' });

/** Returns whether this event may update the current playback preferences. ACK even stale events. */
export async function recordNativeProgress(p: NativeProgress): Promise<boolean> {
  if (p.profileId !== activeProfileId) return false;
  const current = await db.transaction('rw', [db.history, db.progress, db.syncOutbox, db.syncMeta, db.nativeReceipts], async () => {
    const receiptKey = `${p.sessionId}:${p.index}`;
    if (((await db.nativeReceipts.get(receiptKey))?.sequence ?? -1) >= p.sequence) return false;
    await db.nativeReceipts.put({ key: receiptKey, sequence: p.sequence, receivedAt: Date.now() });
    const revision = (await db.syncMeta.get('revision'))?.value || 0;
    // Replayed events from a previous process must not undo a newer server snapshot/deletion.
    if (p.openedAt < pageStartedAt && p.baseRevision < revision) return false;
    const id = `${p.sourceKey}_${p.vodId}`;
    const sessionKey = `latest:${id}`;
    const latest = await db.nativeReceipts.get(sessionKey);
    if (latest?.openedAt && latest.openedAt > p.openedAt) return false;
    const earlierEpisodeEvent = latest?.sessionId === p.sessionId && latest.sequence > p.sequence;
    if (!earlierEpisodeEvent) {
      await db.nativeReceipts.put({ key: sessionKey, sessionId: p.sessionId, openedAt: p.openedAt, sequence: p.sequence, receivedAt: Date.now() });
      const previous = await db.history.get(id);
      const history: HistoryEntry = { ...previous, id, sourceKey: p.sourceKey, sourceUrl: p.sourceUrl, vodId: p.vodId,
        title: p.title, episodeIndex: p.index, totalEpisodes: p.total, playbackPosition: p.position,
        duration: p.duration || (previous?.episodeIndex === p.index ? previous.duration : 0), timestamp: Date.now() };
      await db.history.put(history); await dirty('history', id, history);
    }
    const key = `${id}_${p.index}`;
    const progress = p.ended ? null : { key, position: p.position, duration: p.duration || (await db.progress.get(key))?.duration || 0, updatedAt: Date.now() };
    if (progress) await db.progress.put(progress); else await db.progress.delete(key);
    await dirty('progress', key, progress);
    const receipts = await db.nativeReceipts.count();
    if (receipts > 500) await db.nativeReceipts.orderBy('receivedAt').limit(receipts - 500).delete();
    const count = await db.history.count();
    if (count > MAX_HISTORY) {
      const oldest = await db.history.orderBy('timestamp').limit(count - MAX_HISTORY).toArray();
      for (const row of oldest) { await db.history.delete(row.id); await dirty('history', row.id, null); }
    }
    return !earlierEpisodeEvent;
  });
  notifyHistoryChange();
  return current;
}

async function dirty(kind: SyncKind, key: string, value: HistoryEntry | ProgressEntry | null) {
  if (!activeProfileId) return;
  const revision = (await db.syncMeta.get('revision'))?.value || 0;
  await db.syncOutbox.put({ id: `${kind}:${key}`, mutationId: crypto.randomUUID(), kind, key, value, baseRevision: revision });
}
function notifyHistoryChange() {
  if (activeProfileId && typeof window !== 'undefined') window.dispatchEvent(new Event('libretv:history-changed'));
}
async function writeHistory(action: () => Promise<void>) {
  await db.transaction('rw', [db.history, db.progress, db.syncOutbox, db.syncMeta], action);
  notifyHistoryChange();
}

export const MAX_HISTORY = 100;
export const MAX_SEARCH_HISTORY = 10;

export async function upsertHistory(entry: Omit<HistoryEntry, 'id'>): Promise<void> {
  await writeHistory(async () => {
  const id = `${entry.sourceKey}_${entry.vodId}`;
  const existing = await db.history.get(id);
  const merged: HistoryEntry = {
    ...existing,
    ...entry,
    id,
    playbackPosition: entry.playbackPosition > 0 ? entry.playbackPosition : existing?.episodeIndex === entry.episodeIndex ? existing.playbackPosition : 0,
    duration: entry.duration || (existing?.episodeIndex === entry.episodeIndex ? existing.duration : 0),
    timestamp: Date.now(),
  };
  await db.history.put(merged);
  await dirty('history', id, merged);
  // 淘汰最旧记录
  const count = await db.history.count();
  if (count > MAX_HISTORY) {
    const oldest = await db.history.orderBy('timestamp').limit(count - MAX_HISTORY).toArray();
    await db.history.bulkDelete(oldest.map((o) => o.id));
    for (const row of oldest) await dirty('history', row.id, null);
  }
  });
}

export async function updateHistoryProgress(
  sourceKey: string,
  vodId: string,
  position: number,
  duration: number,
  episodeIndex?: number,
): Promise<void> {
  if (!Number.isFinite(position) || !Number.isFinite(duration) || position < 0 || duration <= 0) return;
  await writeHistory(async () => {
  const id = `${sourceKey}_${vodId}`;
  const existing = await db.history.get(id);
  if (!existing) return;
  if (episodeIndex !== undefined && existing.episodeIndex !== episodeIndex) return;
  if (Math.abs(existing.playbackPosition - position) < 2 && Math.abs(existing.duration - duration) < 2) return;
  const updated = { ...existing,
    playbackPosition: position,
    duration,
    timestamp: Date.now(),
  };
  await db.history.put(updated);
  await dirty('history', id, updated);
  });
}

export async function removeHistory(sourceKey: string, vodId: string): Promise<void> {
  await writeHistory(async () => {
    const id = `${sourceKey}_${vodId}`;
    await db.history.delete(id);
    await dirty('history', id, null);
  });
}

export async function clearAllHistory(): Promise<void> {
  // 一并清进度表：否则从历史重新打开时可能取到已清空的旧进度
  await writeHistory(async () => {
    for (const row of await db.history.toArray()) await dirty('history', row.id, null);
    for (const row of await db.progress.toArray()) await dirty('progress', row.key, null);
    await db.history.clear(); await db.progress.clear();
  });
}

export function progressKeyOf(sourceKey: string, vodId: string, episodeIndex: number): string {
  return `${sourceKey}_${vodId}_${episodeIndex}`;
}

export async function saveProgress(sourceKey: string, vodId: string, episodeIndex: number, position: number, duration: number): Promise<void> {
  if (!Number.isFinite(duration) || !Number.isFinite(position) || !duration || position < 1) return;
  await writeHistory(async () => {
  const entry = {
    key: progressKeyOf(sourceKey, vodId, episodeIndex),
    position,
    duration,
    updatedAt: Date.now(),
  };
  await db.progress.put(entry);
  await dirty('progress', entry.key, entry);
  });
}

export async function clearProgress(sourceKey: string, vodId: string, episodeIndex: number): Promise<void> {
  await writeHistory(async () => {
    const key = progressKeyOf(sourceKey, vodId, episodeIndex);
    await db.progress.delete(key);
    await dirty('progress', key, null);
  });
}

export async function addSearchHistory(text: string): Promise<void> {
  const t = text.trim().slice(0, 50);
  if (!t) return;
  await db.searchHistory.put({ text: t, timestamp: Date.now() });
  const count = await db.searchHistory.count();
  if (count > MAX_SEARCH_HISTORY) {
    const oldest = await db.searchHistory.orderBy('timestamp').limit(count - MAX_SEARCH_HISTORY).toArray();
    await db.searchHistory.bulkDelete(oldest.map((o) => o.text));
  }
}

export async function removeSearchHistory(text: string): Promise<void> {
  await db.searchHistory.delete(text);
}

export async function clearSearchHistory(): Promise<void> {
  await db.searchHistory.clear();
}

/** 撤销「清空搜索记录」：按原时间戳回填，保持原有顺序 */
export async function restoreSearchHistory(entries: SearchHistoryEntry[]): Promise<void> {
  if (entries.length === 0) return;
  await db.searchHistory.bulkPut(entries);
}

// —— 直播测活缓存（TTL 过滤由调用方负责，本层只管存取） ——

export async function loadLiveProbeResults(): Promise<Record<string, LiveProbeEntry>> {
  const rows = await db.liveProbe.toArray();
  const out: Record<string, LiveProbeEntry> = {};
  for (const r of rows) out[r.url] = r;
  return out;
}

export async function saveLiveProbeResults(entries: Record<string, LiveProbeEntry>): Promise<void> {
  const rows = Object.entries(entries).map(([url, e]) => ({ ...e, url }));
  if (rows.length > 0) await db.liveProbe.bulkPut(rows);
}

export async function clearLiveProbeResultsDb(): Promise<void> {
  await db.liveProbe.clear();
}

// —— 配置导入导出（兼容旧版 LibreTV-Settings JSON 结构的导出格式） ——

export async function exportConfig(): Promise<string> {
  // 导出前 flush：把节流缓冲中的最新设置落盘，避免导出的是 800ms 前的旧快照
  flushPendingPersist();
  const history = await db.history.toArray();
  const settings = localStorage.getItem(PERSIST_KEY);

  const data: Record<string, unknown> = {
    viewingHistory: JSON.stringify(history),
  };
  if (settings) data[PERSIST_KEY] = settings;

  return JSON.stringify({
    name: SETTINGS_FORMAT,
    time: Date.now().toString(),
    cfgVer: '2.0.0',
    data,
  });
}

export async function importConfig(content: string): Promise<void> {
  const config = JSON.parse(content) as {
    name?: string;
    data?: Record<string, string>;
  };
  if (!isSettingsFormat(config.name)) throw new Error('配置文件格式不正确');
  const data = config.data || {};

  if (typeof data[PERSIST_KEY] === 'string') {
    // 关键：先 flush 节流缓冲中的旧状态再写导入配置，否则缓冲会在
    // 之后 flush 时用导入前的旧状态覆盖刚写入的配置（导入静默丢失）
    flushPendingPersist();
    localStorage.setItem(PERSIST_KEY, data[PERSIST_KEY]);
  }

  if (typeof data['viewingHistory'] === 'string') {
    // 兼容旧版历史结构（含全集 URL 列表），只迁移定位信息
    const legacy = JSON.parse(data['viewingHistory']) as Record<string, unknown>[];
    for (const item of legacy.slice(0, MAX_HISTORY)) {
      const sourceKey = String(item.sourceCode || item.sourceName || '');
      const vodId = String(item.vod_id || '');
      const title = String(item.title || '未知视频');
      if (!sourceKey || !vodId) continue;
      const totalEpisodes = Array.isArray(item.episodes) ? item.episodes.length : 0;
      await upsertHistory({
        sourceKey,
        vodId,
        title,
        episodeIndex: typeof item.episodeIndex === 'number' ? item.episodeIndex : 0,
        totalEpisodes,
        playbackPosition: typeof item.playbackPosition === 'number' ? item.playbackPosition : 0,
        duration: typeof item.duration === 'number' ? item.duration : 0,
        timestamp: typeof item.timestamp === 'number' ? item.timestamp : Date.now(),
      });
    }
  }
}

export type { SourceConfig };

import { activeAccountId } from './account-client';
import type { HistoryEntry, ProgressEntry } from './db';

export const AVATARS = ['🐱', '🐼', '🦊', '🐰', '🐻', '🐶', '🐨', '🐯'] as const;
export interface FamilyProfile { id: string; name: string; avatar: string }
export type SyncKind = 'history' | 'progress';
export interface SyncMutation {
  id: string;
  mutationId: string;
  kind: SyncKind;
  key: string;
  value: HistoryEntry | ProgressEntry | null;
  baseRevision: number;
}
export interface SyncRow { kind: SyncKind; key: string; value: HistoryEntry | ProgressEntry | null; revision: number }
export interface FamilySnapshot { revision: number; floorRevision: number; rows: SyncRow[] }
export interface SyncResponse extends FamilySnapshot { accepted: string[]; conflicts: string[] }
export const PROFILE_KEY = activeAccountId ? `libretv-family-profile-${activeAccountId}` : 'libretv-family-profile';
export function validProfileId(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value); }
export function readProfileId(): string | null {
  try { const id = localStorage.getItem(PROFILE_KEY); return validProfileId(id) ? id : null; }
  catch { return null; }
}

function text(value: unknown, max: number): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max; }
function number(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max; }
function optionalUrl(value: unknown): boolean { return value === undefined || value === '' || (typeof value === 'string' && value.length <= 4096 && /^https?:\/\//i.test(value)); }

export function parseMutations(input: unknown): SyncMutation[] {
  if (!Array.isArray(input) || input.length > 400) throw new Error('同步记录数量超出限制');
  return input.map(raw => {
    if (!raw || typeof raw !== 'object') throw new Error('同步记录格式不正确');
    const { kind, key, value, mutationId, baseRevision } = raw;
    if (!['history', 'progress'].includes(kind) || !text(key, 4096) || !text(mutationId, 80) ||
        !number(baseRevision) || !Number.isInteger(baseRevision)) throw new Error('同步记录字段不正确');
    let normalized: HistoryEntry | ProgressEntry | null = null;
    if (value !== null) {
      if (!value || typeof value !== 'object') throw new Error('同步内容不正确');
      if (kind === 'history') {
        if (!text(value.sourceKey, 256) || !text(value.vodId, 2048) || !text(value.title, 512) ||
            key !== `${value.sourceKey}_${value.vodId}` || !number(value.episodeIndex, 100000) || !Number.isInteger(value.episodeIndex) ||
            !number(value.totalEpisodes, 100000) || !Number.isInteger(value.totalEpisodes) ||
            !number(value.playbackPosition, 864000) || !number(value.duration, 864000) ||
            !number(value.timestamp) || !optionalUrl(value.sourceUrl) || !optionalUrl(value.pic)) throw new Error('历史记录格式不正确');
        normalized = { id: key, sourceKey: value.sourceKey, vodId: value.vodId, title: value.title,
          sourceUrl: value.sourceUrl, pic: value.pic, episodeIndex: value.episodeIndex, totalEpisodes: value.totalEpisodes,
          playbackPosition: value.playbackPosition, duration: value.duration, timestamp: value.timestamp };
      } else {
        if (value.key !== key || !number(value.position, 864000) || !number(value.duration, 864000) || !number(value.updatedAt)) throw new Error('播放进度格式不正确');
        normalized = { key, position: value.position, duration: value.duration, updatedAt: value.updatedAt };
      }
    }
    return { id: `${kind}:${key}`, kind, key, value: normalized, mutationId, baseRevision };
  });
}

/** Server revisions, not device clocks, prevent stale offline writes resurrecting deleted records. */
export function mergeFamily(snapshot: FamilySnapshot, mutations: SyncMutation[], now = Date.now()): SyncResponse {
  let revision = snapshot.revision;
  const rows = new Map(snapshot.rows.map(row => [`${row.kind}:${row.key}`, { ...row }]));
  const accepted: string[] = [], conflicts: string[] = [];
  for (const mutation of mutations) {
    const old = rows.get(mutation.id);
    if (mutation.baseRevision < snapshot.floorRevision || mutation.baseRevision > snapshot.revision ||
        (old && old.revision > mutation.baseRevision)) { conflicts.push(mutation.mutationId); continue; }
    const value = mutation.value === null ? null : mutation.kind === 'history'
      ? { ...mutation.value, timestamp: now } : { ...mutation.value, updatedAt: now };
    rows.set(mutation.id, { kind: mutation.kind, key: mutation.key, value, revision: ++revision });
    accepted.push(mutation.mutationId);
  }
  let retained = [...rows.values()], floorRevision = snapshot.floorRevision;
  if (retained.length > 1000) {
    floorRevision = revision;
    retained = (['history', 'progress'] as const).flatMap(kind => retained.filter(row => row.kind === kind && row.value)
      .sort((a, b) => b.revision - a.revision).slice(0, kind === 'history' ? 100 : 500));
  }
  return { revision, floorRevision, rows: retained, accepted, conflicts };
}

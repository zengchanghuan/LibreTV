'use client';

import Dexie from 'dexie';
import { activeProfileId, db, type HistoryEntry, type ProgressEntry } from './db';
import type { SyncResponse } from './family-types';

let inFlight: Promise<{ conflicts: number }> | null = null;

export function syncFamily(): Promise<{ conflicts: number }> {
  if (!activeProfileId) return Promise.resolve({ conflicts: 0 });
  if (inFlight) return inFlight;
  // A browser may have multiple tabs sharing this IndexedDB/outbox.
  const operation = async () => {
    if (typeof navigator !== 'undefined' && navigator.locks) {
      return await navigator.locks.request(`libretv-family-sync:${activeProfileId}`, { signal: AbortSignal.timeout(10000) }, performSync);
    }
    return performSync();
  };
  inFlight = operation().finally(() => { inFlight = null; });
  return inFlight;
}

async function performSync() {
  const mutations = await db.syncOutbox.limit(400).toArray();
  const response = await fetch('/api/family/sync', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
    body: JSON.stringify({ profileId: activeProfileId, mutations }), signal: AbortSignal.timeout(8000),
  });
  const snapshot = await response.json() as SyncResponse & { error?: string };
  if (!response.ok) throw new Error(snapshot.error || '同步失败');
  await db.transaction('rw', [db.history, db.progress, db.syncOutbox, db.syncMeta], async () => {
    // A delayed response must not roll back data another tab already synchronized.
    // Keep the outbox intact so the next request can acknowledge or resolve it.
    if (snapshot.revision < ((await db.syncMeta.get('revision'))?.value || 0)) return;
    for (const sent of mutations) {
      const pending = await db.syncOutbox.get(sent.id);
      if (!pending) continue;
      if (pending.mutationId === sent.mutationId) await db.syncOutbox.delete(sent.id);
      // A later local edit made during this request builds on OUR accepted write.
      else if (snapshot.accepted.includes(sent.mutationId)) await db.syncOutbox.update(sent.id, { baseRevision: snapshot.revision });
    }
    const pending = new Set((await db.syncOutbox.toArray()).map(item => item.id));
    const remote = new Set(snapshot.rows.map(row => `${row.kind}:${row.key}`));
    for (const row of snapshot.rows) {
      if (pending.has(`${row.kind}:${row.key}`)) continue;
      if (row.kind === 'history') {
        if (row.value) await db.history.put(row.value as HistoryEntry); else await db.history.delete(row.key);
      } else {
        if (row.value) await db.progress.put(row.value as ProgressEntry); else await db.progress.delete(row.key);
      }
    }
    // Also reconcile records removed during server compaction, without touching unsent writes.
    for (const row of await db.history.toArray()) if (!remote.has(`history:${row.id}`) && !pending.has(`history:${row.id}`)) await db.history.delete(row.id);
    for (const row of await db.progress.toArray()) if (!remote.has(`progress:${row.key}`) && !pending.has(`progress:${row.key}`)) await db.progress.delete(row.key);
    await db.syncMeta.put({ key: 'revision', value: snapshot.revision });
  });
  return { conflicts: snapshot.conflicts.length };
}

/** Explicit opt-in import. The original local-only database is never cleared. */
export async function importLocalHistory() {
  if (!activeProfileId) return;
  const legacy = new Dexie('libretv');
  try {
    if (!(await Dexie.exists('libretv'))) return;
    await legacy.open();
    const rows = await legacy.table<HistoryEntry>('history').toArray();
    const progress = await legacy.table<ProgressEntry>('progress').toArray();
    await db.transaction('rw', [db.history, db.progress, db.syncOutbox, db.syncMeta], async () => {
      const baseRevision = (await db.syncMeta.get('revision'))?.value || 0;
      for (const row of rows) {
        if (await db.history.get(row.id)) continue;
        await db.history.put(row);
        await db.syncOutbox.put({ id: `history:${row.id}`, kind: 'history', key: row.id, value: row, baseRevision, mutationId: crypto.randomUUID() });
      }
      for (const row of progress) {
        if (await db.progress.get(row.key)) continue;
        await db.progress.put(row);
        await db.syncOutbox.put({ id: `progress:${row.key}`, kind: 'progress', key: row.key, value: row, baseRevision, mutationId: crypto.randomUUID() });
      }
    });
    await syncFamily();
  } finally { legacy.close(); }
}

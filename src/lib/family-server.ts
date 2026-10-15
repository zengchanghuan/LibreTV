import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AVATARS, mergeFamily, type FamilyProfile, type FamilySnapshot, type SyncMutation } from './family-types';

interface FamilyFile { version: 1; profiles: FamilyProfile[]; states: Record<string, FamilySnapshot> }
// Shared across route modules in the one Node process supported by the file backend.
const shared = globalThis as typeof globalThis & { libretvFamilyQueues?: Map<string, Promise<unknown>> };
const queues = shared.libretvFamilyQueues ??= new Map();

async function transact<T>(change: (file: FamilyFile) => T, write: boolean): Promise<T> {
  const directory = process.env.LIBRETV_DATA_DIR || path.join(process.cwd(), '.data');
  const filename = path.join(directory, 'family.json');
  const previous = queues.get(filename) || Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    let file: FamilyFile;
    try {
      file = JSON.parse(await readFile(filename, 'utf8'));
      if (file.version !== 1 || !Array.isArray(file.profiles) || !file.states) throw new Error('家庭数据文件格式不正确');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      file = { version: 1, profiles: [], states: {} };
    }
    const result = change(file);
    if (write) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = `${filename}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(file), { mode: 0o600, flag: 'wx' });
        await rename(temporary, filename);
      } finally { await unlink(temporary).catch(() => {}); }
    }
    return result;
  });
  queues.set(filename, operation);
  try { return await operation; }
  finally { if (queues.get(filename) === operation) queues.delete(filename); }
}

export function listProfiles() { return transact(file => file.profiles, false); }

export function createProfile(name: unknown, avatar: unknown) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 24 || !AVATARS.includes(avatar as typeof AVATARS[number])) throw new Error('请输入 1–24 字的名字并选择头像');
  return transact(file => {
    if (file.profiles.length >= 12) throw new Error('最多可创建 12 位家庭成员');
    if (file.profiles.some(profile => profile.name === name.trim())) throw new Error('已有同名成员，请直接选择');
    const profile = { id: randomUUID(), name: name.trim(), avatar: String(avatar) };
    file.profiles.push(profile);
    file.states[profile.id] = { revision: 0, floorRevision: 0, rows: [] };
    return profile;
  }, true);
}

export function syncProfile(id: string, mutations: SyncMutation[]) {
  return transact(file => {
    if (!file.profiles.some(profile => profile.id === id)) throw new Error('家庭成员不存在');
    const result = mergeFamily(file.states[id], mutations);
    file.states[id] = { revision: result.revision, floorRevision: result.floorRevision, rows: result.rows };
    return result;
  }, mutations.length > 0);
}

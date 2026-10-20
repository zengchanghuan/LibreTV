import { readFileSync } from 'node:fs';
import path from 'node:path';
import { scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

export interface Account { id: string; username: string; salt: string; hash: string; sessionVersion: string }
const derive = promisify(scrypt);
export function readAccounts(): Account[] {
  try {
    const file = JSON.parse(readFileSync(path.join(process.env.LIBRETV_DATA_DIR || path.join(process.cwd(), '.data'), 'accounts.json'), 'utf8'));
    if (file.version !== 1 || !Array.isArray(file.accounts) || !file.accounts.every((a: Account) =>
      /^[a-f0-9-]{36}$/.test(a.id) && /^[a-z0-9_-]{1,32}$/.test(a.username) &&
      /^[a-f0-9]{32}$/.test(a.salt) && /^[a-f0-9]{128}$/.test(a.hash) && /^[a-f0-9]{32}$/.test(a.sessionVersion))) throw new Error('Invalid accounts file');
    return file.accounts;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}
export async function checkAccount(username: string, password: string): Promise<Account | null> {
  const account = readAccounts().find(a => a.username === username);
  // Unknown names still incur the password derivation cost.
  const hash = await derive(password, account?.salt || '00000000000000000000000000000000', 64) as Buffer;
  const expected = Buffer.from(account?.hash || '00'.repeat(64), 'hex');
  return timingSafeEqual(hash, expected) && account ? account : null;
}

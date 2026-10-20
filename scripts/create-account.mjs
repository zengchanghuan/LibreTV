#!/usr/bin/env node
// Run on the server as the service user, with LIBRETV_DATA_DIR set.
import { mkdir, readFile, writeFile, rename, unlink, open } from 'node:fs/promises';
import { randomBytes, randomInt, randomUUID, scryptSync } from 'node:crypto';
import path from 'node:path';
const username = (process.argv[2] || '').trim().toLowerCase();
if (!/^[a-z0-9_-]{1,32}$/.test(username)) throw new Error('Usage: LIBRETV_DATA_DIR=... node scripts/create-account.mjs USERNAME');
const directory = process.env.LIBRETV_DATA_DIR || path.join(process.cwd(), '.data');
await mkdir(directory, { recursive: true, mode: 0o700 });
const filename = path.join(directory, 'accounts.json');
const lockname = `${filename}.lock`;
const lock = await open(lockname, 'wx', 0o600);
const temporary = `${filename}.${randomUUID()}.tmp`;
try {
  let file;
  try { file = JSON.parse(await readFile(filename, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; file = { version: 1, accounts: [] }; }
  if (file.version !== 1 || !Array.isArray(file.accounts)) throw new Error('Invalid accounts file');
  if (file.accounts.some(a => a.username === username)) throw new Error('Account already exists; unchanged');
  const password = String(randomInt(0, 1000000)).padStart(6, '0');
  const salt = randomBytes(16).toString('hex');
  const account = { id: randomUUID(), username, salt, hash: scryptSync(password, salt, 64).toString('hex'), sessionVersion: randomBytes(16).toString('hex') };
  file.accounts.push(account);
  await writeFile(temporary, JSON.stringify(file), { mode: 0o600, flag: 'wx' });
  await rename(temporary, filename);
  // Only this interactive command outputs the newly generated password; never store it in release metadata.
  console.log(JSON.stringify({ username, password }));
} finally {
  await unlink(temporary).catch(() => {});
  await lock.close();
  await unlink(lockname);
}

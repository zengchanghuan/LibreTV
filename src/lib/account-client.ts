export const ACCOUNT_KEY = 'hometv-account';
export function readAccountId(): string | null {
  try { const id = localStorage.getItem(ACCOUNT_KEY); return id && /^[a-f0-9-]{36}$/.test(id) ? id : null; }
  catch { return null; }
}
export const activeAccountId = readAccountId();
export const localDatabaseName = activeAccountId ? `hometv-account-${activeAccountId}` : 'libretv';
export function applyAccount(accountId: string | null): boolean {
  if (accountId) localStorage.setItem(ACCOUNT_KEY, accountId); else localStorage.removeItem(ACCOUNT_KEY);
  if (accountId !== activeAccountId) { location.replace('/'); return true; }
  return false;
}

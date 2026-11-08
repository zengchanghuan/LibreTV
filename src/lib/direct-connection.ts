/**
 * Browser-side routing assistance only: a web page cannot override a system proxy/VPN.
 * Keep exact hosts in this tab's sessionStorage; never retain URLs, tokens or titles.
 */
export const DIRECT_HOSTS_KEY = 'libretv-direct-hosts-v1';
export const MAX_DIRECT_HOSTS = 256;
export type DirectRuleFormat = 'clash' | 'text';

/** Validate before emitting rule syntax, including values restored from storage. */
function normalizeHost(value: string): string | null {
  const host = value.toLowerCase().replace(/\.$/, '');
  if (!host || host.length > 253 || !/^[a-z0-9.:[\]-]+$/.test(host)) return null;
  try {
    if (host.includes(':')) {
      const bracketed = host.startsWith('[') ? host : `[${host}]`;
      return new URL(`https://${bracketed}/`).hostname.slice(1, -1);
    }
    if (!host.split('.').every((part) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))) return null;
    return new URL(`https://${host}/`).hostname;
  } catch {
    return null;
  }
}

export function requestHost(url: string, base?: string): string | null {
  try {
    const parsed = new URL(url, base);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return normalizeHost(parsed.hostname);
  } catch {
    return null;
  }
}

export function buildDirectRules(hosts: string[], format: DirectRuleFormat): string {
  const valid = [...new Set(hosts.map(normalizeHost).filter((host): host is string => !!host))];
  const lines = valid.map((host) => {
    if (host.includes(':')) return `IP-CIDR6,${host}/128,DIRECT,no-resolve`;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return `IP-CIDR,${host}/32,DIRECT,no-resolve`;
    return `DOMAIN,${host},DIRECT`;
  });
  const note = '# HomeTV 直连规则：需在代理工具中应用，保存文件不会自动生效。\n';
  if (format === 'clash') {
    return note + '# 将条目合并到现有 rules 最前面，并使用规则模式；不要替换整个订阅配置。\n'
      + (lines.length ? `rules:\n${lines.map((line) => `  - ${line}`).join('\n')}\n` : 'rules: []\n');
  }
  return note + '# 规则片段，请添加到支持此语法的工具的规则列表最前面。\n' + lines.join('\n') + '\n';
}

let hosts: Set<string> | undefined;
const listeners = new Set<() => void>();

function loadHosts(): Set<string> {
  if (hosts) return hosts;
  hosts = new Set();
  try {
    const saved: unknown = JSON.parse(window.sessionStorage.getItem(DIRECT_HOSTS_KEY) || '[]');
    if (Array.isArray(saved)) {
      for (const value of saved.slice(-MAX_DIRECT_HOSTS)) {
        const host = typeof value === 'string' ? normalizeHost(value) : null;
        if (host) hosts.add(host);
      }
    }
  } catch { /* Storage unavailable or malformed: the in-memory list still works. */ }
  return hosts;
}

/** Record the browser-facing host only. Do not unwrap server proxy query strings. */
export function recordDirectRequest(url: string): void {
  if (typeof window === 'undefined') return;
  const host = requestHost(url, window.location.href);
  if (!host) return;
  const current = loadHosts();
  if (current.has(host)) return;
  current.add(host);
  if (current.size > MAX_DIRECT_HOSTS) current.delete(current.values().next().value!);
  try { window.sessionStorage.setItem(DIRECT_HOSTS_KEY, JSON.stringify([...current])); }
  catch { /* Private browsing / quota: never interrupt playback. */ }
  listeners.forEach((notify) => notify());
}

export function getDirectHosts(): string[] {
  if (typeof window === 'undefined') return [];
  const site = requestHost(window.location.href);
  return [...new Set([...(site ? [site] : []), ...[...loadHosts()].sort()])];
}

export function subscribeDirectHosts(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function clearDirectHosts(): void {
  hosts = new Set();
  try { window.sessionStorage.removeItem(DIRECT_HOSTS_KEY); } catch { /* Best effort. */ }
  listeners.forEach((notify) => notify());
}

/** Passive observation covers images, fetches, downloads and browser-visible media requests. */
export function observeDirectRequests(): () => void {
  if (typeof window === 'undefined') return () => {};
  const record = (entries: PerformanceEntry[]) => entries.forEach((entry) => recordDirectRequest(entry.name));
  try { record(performance.getEntriesByType('resource')); } catch { /* Optional browser API. */ }
  try {
    const observer = new PerformanceObserver((list) => record(list.getEntries()));
    observer.observe({ type: 'resource', buffered: true });
    return () => observer.disconnect();
  } catch {
    // Player/image hooks still collect their initial requests on older browsers.
    return () => {};
  }
}

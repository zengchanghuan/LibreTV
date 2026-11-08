import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildDirectRules, clearDirectHosts, DIRECT_HOSTS_KEY, getDirectHosts,
  MAX_DIRECT_HOSTS, observeDirectRequests, recordDirectRequest, requestHost, subscribeDirectHosts,
} from './direct-connection';

let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal('window', {
    location: { href: 'https://tv.example/watch?token=private' },
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
      removeItem: (key: string) => storage.delete(key),
    },
  });
  clearDirectHosts();
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('exact direct rules', () => {
  it('emits only exact hosts and single IP addresses, without broad CDN or catch-all rules', () => {
    const rules = buildDirectRules(['cdn.example', 'CDN.EXAMPLE.', '192.0.2.1', '[2001:db8::1]'], 'clash');
    expect(rules).toContain('rules:\n  - DOMAIN,cdn.example,DIRECT\n');
    expect(rules.match(/DOMAIN,/g)).toHaveLength(1);
    expect(rules).toContain('IP-CIDR,192.0.2.1/32,DIRECT,no-resolve');
    expect(rules).toContain('IP-CIDR6,2001:db8::1/128,DIRECT,no-resolve');
    expect(rules).not.toMatch(/DOMAIN-SUFFIX|MATCH,|FINAL,/);
  });

  it('rejects injected rule syntax and full URLs even in restored host data', () => {
    const rules = buildDirectRules([
      'valid.example', 'bad.example\nMATCH,PROXY', 'bad.example,DIRECT',
      '*.example', 'https://secret.example/video?token=secret', 'bad.example#rule', 'bad.example@other.example',
    ], 'text');
    const entries = rules.split('\n').filter((line) => line && !line.startsWith('#'));
    expect(entries).toEqual(['DOMAIN,valid.example,DIRECT']);
  });

  it('extracts hosts from relative/IDN URLs, ignoring tokens and unsupported protocols', () => {
    expect(requestHost('/api/proxy?url=https%3A%2F%2Fupstream.example%2Fvideo', window.location.href)).toBe('tv.example');
    expect(requestHost('https://user:password@CDN.Example.:8443/file?token=secret')).toBe('cdn.example');
    expect(requestHost('https://例子.测试/file')).toBe('xn--fsqu00a.xn--0zwm56d');
    expect(requestHost('http://[2001:db8::2]:8080/live')).toBe('2001:db8::2');
    for (const url of ['blob:https://cdn.example/id', 'data:text/plain,hi', 'javascript:alert(1)', 'invalid']) {
      expect(requestHost(url)).toBeNull();
    }
  });
});

describe('tab-local host collection', () => {
  it('stores hosts only, deduplicates segments and keeps the current site first', () => {
    recordDirectRequest('https://cdn.example/episode/1.ts?token=secret');
    recordDirectRequest('https://cdn.example/episode/2.ts?token=secret');
    recordDirectRequest('/api/proxy?url=https://server-only.example/video');
    expect(getDirectHosts()).toEqual(['tv.example', 'cdn.example']);
    expect(storage.get(DIRECT_HOSTS_KEY)).toBe('["cdn.example","tv.example"]');
    expect(window.sessionStorage.setItem).toHaveBeenCalledTimes(2);
  });

  it('limits host history and clears it while preserving the current site', () => {
    for (let i = 0; i <= MAX_DIRECT_HOSTS; i++) recordDirectRequest(`https://cdn${i}.example/a`);
    expect(JSON.parse(storage.get(DIRECT_HOSTS_KEY)!)).toHaveLength(MAX_DIRECT_HOSTS);
    expect(getDirectHosts()).not.toContain('cdn0.example');
    const notify = vi.fn();
    const unsubscribe = subscribeDirectHosts(notify);
    clearDirectHosts();
    expect(notify).toHaveBeenCalledOnce();
    unsubscribe();
    expect(getDirectHosts()).toEqual(['tv.example']);
    expect(storage.has(DIRECT_HOSTS_KEY)).toBe(false);
    recordDirectRequest('https://new.example/segment');
    expect(notify).toHaveBeenCalledOnce();
    expect(getDirectHosts()).toContain('new.example');
  });

  it('never breaks playback when session storage is blocked', () => {
    Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('blocked'); } });
    expect(() => recordDirectRequest('https://cdn.example/file')).not.toThrow();
    expect(getDirectHosts()).toContain('cdn.example');
    expect(() => clearDirectHosts()).not.toThrow();
  });

  it('restores only validated hosts after a page reload', async () => {
    storage.set(DIRECT_HOSTS_KEY, JSON.stringify(['cdn.example', 'evil,PROXY', null, 'https://token.example/?secret']));
    vi.resetModules();
    const reloaded = await import('./direct-connection');
    expect(reloaded.getDirectHosts()).toEqual(['tv.example', 'cdn.example']);
  });

  it('is safe during server rendering and without PerformanceObserver support', () => {
    vi.stubGlobal('PerformanceObserver', undefined);
    vi.stubGlobal('performance', { getEntriesByType: () => [{ name: 'https://image.example/cover' }] });
    const stop = observeDirectRequests();
    expect(getDirectHosts()).toContain('image.example');
    expect(stop).not.toThrow();
    vi.stubGlobal('window', undefined);
    expect(() => recordDirectRequest('https://unused.example')).not.toThrow();
    expect(getDirectHosts()).toEqual([]);
    expect(observeDirectRequests()).not.toThrow();
  });

  it('collects subsequent resource entries and disconnects when unmounted', () => {
    let callback: PerformanceObserverCallback;
    const disconnect = vi.fn();
    vi.stubGlobal('performance', { getEntriesByType: () => [] });
    vi.stubGlobal('PerformanceObserver', class {
      constructor(cb: PerformanceObserverCallback) { callback = cb; }
      observe = vi.fn();
      disconnect = disconnect;
    });
    const stop = observeDirectRequests();
    callback!({ getEntries: () => [{ name: 'https://segment.example/key?secret=1' }] } as PerformanceObserverEntryList, {} as PerformanceObserver);
    expect(getDirectHosts()).toContain('segment.example');
    stop();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});

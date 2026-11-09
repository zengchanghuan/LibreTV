import { describe, expect, it, vi, afterEach } from 'vitest';
import { calendarDate, DAY, emptyDiscovery, mergeDiscovery, parseDiscoveryItem, recentCards, sourceIdentity } from './discovery-catalog';
import { creditWatch, emptyWatchState, rankPopular, startWatch } from './discovery-popularity';
import { watchedSeconds } from './watch-sampling';
import { publishedEditorial } from './discovery-editorial';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoveryTransaction } from './discovery-storage';
import { homeContentKinds } from './home-content-preferences';

const now = Date.parse('2026-11-08T12:00:00+08:00');
const source = { key: 'env_0', name: 'test', url: 'https://one.example/api.php/provide/vod' };
const other = { ...source, key: 'env_1', url: 'https://two.example/api.php/provide/vod' };
const raw = { vod_id: 1, vod_name: '测试影片', vod_year: '2026', type_name: '剧情片', vod_pubdate: '2026-11-06', vod_play_url: '正片$https://cdn.example/1.m3u8' };
afterEach(() => vi.unstubAllEnvs());
describe('discovery dates and resources', () => {
  it('rejects incomplete, impossible and future dates', () => {
    for (const value of ['2026', '2026-02-30', '2026-13-01', '2026-11-09', '今日更新']) expect(calendarDate(value, now)).toBeUndefined();
    expect(calendarDate('2026-11-06(中国大陆)', now)).toBe('2026-11-06');
  });
  it('requires agreeing source dates; ingestion and source edits never make an old movie new', () => {
    const a = parseDiscoveryItem(raw, source, now)!, b = parseDiscoveryItem(raw, other, now)!;
    const allowed = new Set([sourceIdentity(source.url), sourceIdentity(other.url)]);
    expect(recentCards([a], allowed, now).new).toHaveLength(0);
    const combined = mergeDiscovery([a], [b], now);
    expect(combined).toHaveLength(1);
    expect(recentCards(combined, allowed, now).new).toHaveLength(1);
    expect(recentCards(combined, new Set([sourceIdentity(source.url)]), now).new).toHaveLength(0);
    b.resources[0].releaseDate = '2026-11-05';
    expect(recentCards(mergeDiscovery([a], [b], now), allowed, now).new).toHaveLength(0);
    const old = parseDiscoveryItem({ ...raw, vod_year: '1990', vod_pubdate: '1990-01-01', vod_time: '2026-11-08' }, source, now)!;
    expect(recentCards([old], allowed, now).added).toHaveLength(1);
    expect(recentCards([old], allowed, now).new).toHaveLength(0);
  });
  it('only records episode growth after a baseline, preserves firstSeen, expires individual sources', () => {
    const a = parseDiscoveryItem({ ...raw, type_name: '国产剧' }, source, now)!;
    const allowed = new Set([sourceIdentity(source.url)]);
    expect(recentCards([a], allowed, now).series).toHaveLength(0);
    const edited = parseDiscoveryItem({ ...raw, type_name: '国产剧', vod_play_url: '正片$https://new.example/a.m3u8' }, source, now + 1000)!;
    expect(recentCards(mergeDiscovery([a], [edited], now + 1000), allowed, now + 1000).series).toHaveLength(0);
    const b = parseDiscoveryItem({ ...raw, type_name: '国产剧', vod_play_url: raw.vod_play_url + '#第二集$https://cdn.example/2.m3u8' }, source, now + 2000)!;
    const merged = mergeDiscovery([a], [b], now + 2000);
    expect(merged[0].firstSeenAt).toBe(now);
    expect(recentCards(merged, allowed, now + 2000).series[0].label).toBe('更新至 2 集');
    expect(recentCards(merged, allowed, now + DAY + 3000).added).toHaveLength(0);
  });
  it('keeps remakes separate and excludes trailers and adult resources', () => {
    const a = parseDiscoveryItem(raw, source, now)!;
    const remake = parseDiscoveryItem({ ...raw, vod_year: '2000' }, other, now)!;
    expect(mergeDiscovery([a], [remake], now)).toHaveLength(2);
    expect(parseDiscoveryItem({ ...raw, vod_name: '测试影片解说' }, source, now)).toBeUndefined();
    expect(parseDiscoveryItem(raw, { ...source, isAdult: true }, now)).toBeUndefined();
  });
  it('excludes future-year source metadata, including entries cached before validation', () => {
    expect(parseDiscoveryItem({ ...raw, vod_year: '2027' }, source, now)).toBeUndefined();
    const cached = parseDiscoveryItem(raw, source, now)!;
    cached.work.year = '2027';
    expect(recentCards([cached], new Set([sourceIdentity(source.url)]), now).added).toHaveLength(0);
  });
});
describe('real watching', () => {
  const sample = { at: 1000, position: 10, playing: true, seeking: false, ready: true, rate: 1 };
  it('ignores seeks, stalls, pauses and long suspended timers', () => {
    expect(watchedSeconds(sample, { ...sample, at: 2000, position: 11 })).toBe(1);
    for (const next of [{ at: 2000, position: 300 }, { at: 2000, position: 10 }, { at: 5000, position: 14 }, { at: 2000, position: 11, playing: false }, { at: 2000, position: 11, seeking: true }]) expect(watchedSeconds(sample, { ...sample, ...next })).toBe(0);
  });
  it('caps client time, rejects another account, deduplicates retries and concurrent tabs', () => {
    const state = emptyWatchState(), id = startWatch(state, 'a', 'w', now);
    expect(() => creditWatch(state, 'b', id, 1, 30, 7200, now + 30000)).toThrow();
    expect(creditWatch(state, 'a', id, 1, 30, 7200, now + 1000).qualified).toBe(false);
    expect(state.sessions[0].played).toBe(1);
    creditWatch(state, 'a', id, 1, 30, 7200, now + 30000);
    expect(state.sessions[0].played).toBe(1);
    const tab = startWatch(state, 'a', 'w', now + 1000);
    creditWatch(state, 'a', id, 2, 30, 7200, now + 31000);
    creditWatch(state, 'a', tab, 1, 30, 7200, now + 31000);
    expect(state.sessions.reduce((n, s) => n + s.played, 0)).toBe(31);
  });
  it('needs five minutes and three unique accounts; repeated devices and expired votes do not inflate ranking', () => {
    const state = emptyWatchState(), work = parseDiscoveryItem(raw, source, now)!.work;
    for (const actor of ['a', 'a', 'b', 'c']) {
      const id = startWatch(state, actor, work.id, now);
      for (let n = 1; n <= 10; n++) creditWatch(state, actor, id, n, 30, 7200, now + n * 30000);
    }
    // The second concurrent session cannot duplicate the first account's wall-clock budget.
    expect(new Set(state.votes.map(v => v.actor)).size).toBe(3);
    expect(rankPopular(state, [work], now + 300001)).toHaveLength(1);
    expect(rankPopular(state, [work], now + 8 * DAY)).toHaveLength(0);
  });
  it('counts eighty percent for a short video and handles expired sessions', () => {
    const state = emptyWatchState(), id = startWatch(state, 'a', 'w', now);
    for (let n = 1; n <= 3; n++) creditWatch(state, 'a', id, n, 30, 120, now + n * 30000);
    expect(state.votes).toHaveLength(0);
    expect(creditWatch(state, 'a', id, 4, 6, 120, now + 96000).qualified).toBe(true);
    expect(() => creditWatch(state, 'a', id, 5, 30, 120, now + DAY)).toThrow();
  });
});
describe('editorial and durable storage', () => {
  it('publishes only verified manual lists and rotates at Shanghai Monday', () => {
    const sunday = publishedEditorial(now);
    expect(sunday).toHaveLength(3);
    expect(sunday.every(i => i.works.length === 6 && i.works.every(w => w.poster && w.metadata?.source))).toBe(true);
    expect(publishedEditorial(Date.parse('2026-11-08T23:59:59+08:00'))[0].id).toBe(sunday[0].id);
    expect(publishedEditorial(Date.parse('2026-11-09T00:00:00+08:00'))[0].id).not.toBe(sunday[0].id);
  });
  it('serializes concurrent writes and restores from the file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hometv-discovery-test-')); vi.stubEnv('LIBRETV_DATA_DIR', dir);
    try {
      await Promise.all(Array.from({ length: 20 }, () => discoveryTransaction('counter', () => ({ n: 0 }), d => { d.n++; }, true)));
      expect(await discoveryTransaction('counter', () => ({ n: 0 }), d => d.n)).toBe(20);
    } finally { await rm(dir, { recursive: true }); }
  });
});

describe('independent module failure', () => {
  it('keeps editorial content available if a persisted statistics file is damaged', async () => {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const { readDiscovery } = await import('./discovery-service');
    const dir = await mkdtemp(join(tmpdir(), 'hometv-discovery-failure-')); vi.stubEnv('LIBRETV_DATA_DIR', dir);
    try {
      await mkdir(join(dir, 'discovery')); await writeFile(join(dir, 'discovery', 'watch.json'), 'broken');
      const result = await readDiscovery([], now);
      expect(result.popularStatus).toBe('unavailable'); expect(result.editorial).toHaveLength(3);
      await writeFile(join(dir, 'discovery', 'catalog.json'), 'broken');
      const degraded = await readDiscovery([], now);
      expect(degraded.partial).toBe(true); expect(degraded.editorial).toHaveLength(3);
    } finally { await rm(dir, { recursive: true }); }
  });
});

describe('personal recent candidates', () => {
  it('filters the full catalog before the cap, keeps date ordering, and does not modify the shared catalog', async () => {
    const { readDiscovery } = await import('./discovery-service');
    const dir = await mkdtemp(join(tmpdir(), 'hometv-discovery-preferences-')); vi.stubEnv('LIBRETV_DATA_DIR', dir);
    vi.stubEnv('DEFAULT_SOURCES', JSON.stringify([{ name: source.name, url: source.url }]));
    try {
      const shorts = Array.from({ length: 60 }, (_, i) => parseDiscoveryItem({ ...raw, vod_id: i + 1, vod_name: `短剧${i}`, type_name: '短剧' }, source, now)!);
      const movies = Array.from({ length: 7 }, (_, i) => parseDiscoveryItem({ ...raw, vod_id: i + 100, vod_name: `电影${i}` }, source, now - 1000 - i)!);
      await discoveryTransaction('catalog', emptyDiscovery, data => { data.works = [...shorts, ...movies]; data.refreshedAt = now; }, true);
      const baseline = await readDiscovery(['env_0'], now);
      expect(baseline.recent.added).toHaveLength(48);
      expect(baseline.recent.added.every(card => card.work.mediaType === 'short')).toBe(true);
      const preferences = shorts.slice(0, 2).map(({ work }) => ({ workId: work.id, work, vote: 'dislike' as const, updatedAt: now }));
      const personal = await readDiscovery(['env_0'], now, preferences);
      expect(personal.recent.added.map(card => card.work.title)).toEqual(movies.map(entry => entry.work.title));
      expect(personal.recent.added.some(card => homeContentKinds(card.work).includes('short'))).toBe(false);
      expect((await readDiscovery(['env_0'], now)).recent.added).toEqual(baseline.recent.added);
    } finally { await rm(dir, { recursive: true }); }
  });
});

import { describe, expect, it } from 'vitest';
import { liveFavoriteUrls, reconcileLiveFavorites, resolveLiveFavorite, toggleLiveFavorite } from './live-favorites';

const old = { url: 'https://stream.test/old', sourceUrl: 'https://source.test/english.m3u', tvgId: 'BBCNews.uk' };
const updated = { ...old, url: 'https://stream.test/new' };

describe('live favorites across subscription updates', () => {
  it('follows a stable id through multiple URL changes and can be unfavorited', () => {
    const next = reconcileLiveFavorites([old], [updated], []);
    expect(next).toEqual([updated]);
    expect([...liveFavoriteUrls(next, [updated])]).toEqual([updated.url]);
    const latest = { ...updated, url: 'https://stream.test/latest' };
    expect(reconcileLiveFavorites(next, [latest], [])).toEqual([latest]);
    expect(toggleLiveFavorite(next, updated)).toEqual([]);
  });
  it('upgrades legacy URL favorites before the first address update', () => {
    const migrated = reconcileLiveFavorites([old.url], [old], []);
    expect(migrated).toEqual([old]);
    expect(reconcileLiveFavorites(migrated, [updated], [])).toEqual([updated]);
  });
  it('uses watch history to recover an old URL already absent from the playlist', () => {
    expect(reconcileLiveFavorites([old.url], [updated], [old])).toEqual([updated]);
  });
  it('does not match another subscription with the same channel id or a reused URL', () => {
    const foreign = { ...updated, sourceUrl: 'https://other.test/list.m3u' };
    const reused = { ...old, tvgId: 'OtherChannel' };
    expect(resolveLiveFavorite(old, [foreign, reused])).toBeUndefined();
    expect([...liveFavoriteUrls([old], [foreign, reused])]).toEqual([]);
    expect(reconcileLiveFavorites([old], [foreign, reused], [])).toEqual([old]);
  });
  it('retains favorites while a subscription is disabled or fails, then recovers', () => {
    const saved = reconcileLiveFavorites([old], [], []);
    expect(saved).toEqual([old]);
    expect(reconcileLiveFavorites(saved, [updated], [])).toEqual([updated]);
  });
  it('preserves the selected rendition and refuses an ambiguous replacement', () => {
    const second = { ...updated, url: 'https://stream.test/second' };
    expect(resolveLiveFavorite(old, [updated, old])).toEqual(old);
    expect(resolveLiveFavorite(old, [updated, second])).toBeUndefined();
    expect(reconcileLiveFavorites([old], [updated, second], [])).toEqual([old]);
    expect(toggleLiveFavorite([old], updated)).toEqual([updated]);
  });
  it('keeps unknown legacy favorites without matching by name or bare channel id', () => {
    expect(reconcileLiveFavorites([old.url], [updated], [])).toEqual([{ url: old.url }]);
    expect(resolveLiveFavorite({ url: old.url, tvgId: old.tvgId }, [updated])).toBeUndefined();
  });
  it('does not guess a subscription when a legacy stream URL is shared', () => {
    const shared = { ...old, sourceUrl: 'https://other.test/list.m3u' };
    expect(reconcileLiveFavorites([old.url], [old, shared], [])).toEqual([{ url: old.url }]);
  });
  it('resolves against all source entries even when the displayed list deduplicates URLs', () => {
    const preferred = { ...updated, sourceUrl: 'https://source.test/verified.m3u' };
    expect([...liveFavoriteUrls([old], [preferred, updated])]).toEqual([updated.url]);
  });
  it('deduplicates old/new records for the same channel after reconciliation', () => {
    expect(reconcileLiveFavorites([old, updated], [updated], [])).toEqual([updated]);
  });
});

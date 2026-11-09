import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { publicHomeFeedback, readHomeFeedback, saveHomeFeedback } from './home-feedback';
import { recommendationCatalog, recommendationByTitle } from './recommendation-catalog';
import { discoveryTransaction } from './discovery-storage';
import { emptyDiscovery } from './discovery-catalog';
import { nextHomeVote } from './home-feedback-types';

let directory: string;
const works = [...new Map(recommendationCatalog.map(work => [work.id, work])).values()].slice(0, 3);
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'home-feedback-test-'));
  vi.stubEnv('LIBRETV_DATA_DIR', directory); vi.stubEnv('PASSWORD', 'feedback-tests-only'); vi.stubEnv('PROXY_SECRET', '');
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

describe('persistent home feedback', () => {
  it('separates old votes that shared an incorrect source ID using their stored titles', () => {
    const first = recommendationByTitle('海滩的一天', 1983)!;
    const second = recommendationByTitle('看海的日子', 1983)!;
    expect(first.id).not.toBe(second.id);
    const oldId = 'local:douban:1298871:1983';
    const result = publicHomeFeedback([
      { workId: oldId, vote: 'like', updatedAt: 1, work: { ...first, id: oldId } },
      { workId: oldId, vote: 'dislike', updatedAt: 2, work: { ...second, id: oldId } },
    ]);
    expect(result.items.map(item => [item.workId, item.vote])).toEqual([[second.id, 'dislike'], [first.id, 'like']]);
  });
  it('stores one vote per account/work, switches and clears idempotently', async () => {
    const id = works[0].id;
    expect(nextHomeVote(undefined, 'like')).toBe('like');
    expect(nextHomeVote('like', 'like')).toBeNull();
    expect(nextHomeVote('like', 'dislike')).toBe('dislike');
    await saveHomeFeedback('alice', id, 'like', 1);
    await saveHomeFeedback('alice', id, 'like', 2);
    expect(await readHomeFeedback('alice')).toHaveLength(1);
    await saveHomeFeedback('alice', id, 'dislike', 3);
    expect(await readHomeFeedback('alice')).toMatchObject([{ workId: id, vote: 'dislike', updatedAt: 3 }]);
    expect(await readHomeFeedback('bob')).toEqual([]);
    expect(await readHomeFeedback(null)).toEqual([]);
    await saveHomeFeedback('alice', id, null);
    await saveHomeFeedback('alice', id, null);
    expect(await readHomeFeedback('alice')).toEqual([]);
  });
  it('persists trusted metadata and keeps concurrent writes across works and accounts', async () => {
    await Promise.all(works.flatMap(work => ['alice', 'bob'].map(account => saveHomeFeedback(account, work.id, account === 'alice' ? 'like' : 'dislike'))));
    expect(await readHomeFeedback('alice')).toHaveLength(3);
    expect((await readHomeFeedback('bob')).every(item => item.vote === 'dislike')).toBe(true);
    const files = await readdir(join(directory, 'discovery'));
    expect(files).toHaveLength(2); expect(files.every(file => /^feedback-[a-f0-9]{64}\.json$/.test(file))).toBe(true);
    for (const file of files) {
      const text = await readFile(join(directory, 'discovery', file), 'utf8');
      expect(text).not.toContain('alice'); expect(text).not.toContain('bob'); expect(text).not.toContain('poster');
    }
    vi.resetModules();
    const restored = await import('./home-feedback');
    expect(await restored.readHomeFeedback('alice')).toEqual(await readHomeFeedback('alice'));
    for (const item of await restored.readHomeFeedback('alice')) {
      expect(item.work.directors).toEqual(works.find(work => work.id === item.workId)?.directors);
    }
  });
  it('accepts recent source works, rejects unknown IDs, and allows undo after catalog removal', async () => {
    const work = { ...works[0], id: 'discovery:test', title: '近期收录影片' };
    await discoveryTransaction('catalog', emptyDiscovery, data => { data.works.push({ work, resources: [], firstSeenAt: 1 }); }, true);
    expect(await saveHomeFeedback('alice', 'forged', 'like')).toBeNull();
    await saveHomeFeedback('alice', work.id, 'like');
    expect((await readHomeFeedback('alice'))[0].work.title).toBe(work.title);
    await discoveryTransaction('catalog', emptyDiscovery, data => { data.works = []; }, true);
    expect(await saveHomeFeedback('alice', work.id, 'dislike')).toMatchObject({ items: [{ vote: 'dislike' }] });
    await saveHomeFeedback('alice', work.id, null);
    expect(await readHomeFeedback('alice')).toEqual([]);
  });
  it('derives format signals from old stored feedback and keeps observed source labels when saving known films', async () => {
    const old = [{ workId: 'old-anime', vote: 'dislike' as const, updatedAt: 1, work: { ...works[0], id: 'old-anime', mediaType: 'movie' as const, genres: ['国产动漫'] } }];
    expect(publicHomeFeedback(old).items[0].contentKinds).toEqual(['animation']);
    const observed = { ...works[0], genres: [...works[0].genres, '日本动漫'] };
    await discoveryTransaction('catalog', emptyDiscovery, data => { data.works.push({ work: observed, resources: [], firstSeenAt: 1 }); }, true);
    const result = await saveHomeFeedback('alice', observed.id, 'dislike');
    expect(result?.items[0].contentKinds).toEqual(['animation']);
    expect(publicHomeFeedback(await readHomeFeedback('alice'))).toEqual(result);
    expect(publicHomeFeedback(await readHomeFeedback('bob'))).toEqual({ items: [] });
  });
});

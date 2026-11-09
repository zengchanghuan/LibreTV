import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './client-api';
import { contextForFilm } from './work-search';
import type { SearchStreamEvent, SourceConfig } from './types';

const source: SourceConfig = { key: 'test', name: '测试源', url: 'https://test.example/api.php' };
const original = '光海，成为王的男人';
const result = { sourceKey: 'test', sourceName: '测试源', vodId: '1', name: original, year: '2012', typeName: '电影' };
const response = (events: SearchStreamEvent[]) => new Response(events.map(e => JSON.stringify(e)).join('\n') + '\n');
afterEach(() => vi.unstubAllGlobals());

describe('incremental alias search client', () => {
  it('separates progress from the single final source health event and forwards context', async () => {
    const fetch = vi.fn().mockResolvedValue(response([
      { type: 'progress', sourceKey: 'test', ok: true, list: [result], ms: 10 },
      { type: 'source', sourceKey: 'test', ok: true, list: [result], ms: 20 },
      { type: 'done', list: [result], failures: [] },
    ]));
    vi.stubGlobal('fetch', fetch);
    const onSource = vi.fn(), onProgress = vi.fn(), context = contextForFilm(original, 2012, 'movie');
    const found = await api.search(original, [source], true, { context, onSource, onProgress });
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onSource).toHaveBeenCalledTimes(1);
    expect(found).toEqual({ list: [result], failures: [] });
    expect(JSON.parse(fetch.mock.calls[0][1].body).context).toEqual(context);
  });

  it('retains a verified alias match when the connection closes before done, without inventing a health event', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([
      { type: 'progress', sourceKey: 'test', ok: true, list: [result], ms: 10 },
    ])));
    const onSource = vi.fn();
    const found = await api.search(original, [source], true, { onSource, context: contextForFilm(original, 2012, 'movie') });
    expect(found.list).toMatchObject([{ ...result, workId: 'tmdb:movie:133200' }]);
    expect(found.failures).toMatchObject([{ sourceKey: 'test', partial: true }]);
    expect(onSource).not.toHaveBeenCalled();
  });

  it('marks an empty truncated stream as incomplete rather than a successful empty search', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('')));
    const found = await api.search(original, [source], true, { onSource: vi.fn() });
    expect(found.list).toEqual([]);
    expect(found.failures).toHaveLength(1);
  });
});

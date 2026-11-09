import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deepSeekRecommendations, parseDeepSeekWorks } from './deepseek-recommendations';
import { fetchUpstream, getCache, setCache } from './fetch-utils';
import { seedWork } from './recommendations';
import { recommendationByTitle } from './recommendation-catalog';

vi.mock('./fetch-utils', () => ({ fetchUpstream: vi.fn(), getCache: vi.fn(), setCache: vi.fn() }));
const seed = seedWork({ title: '亲切的金子', year: '2005', typeName: '电影', sourceKey: '', sourceName: '' });
const item = { title: '老男孩', year: '2003', mediaType: 'movie', aliases: ['不可信别名'], adult: false, reason: '复仇主题与人物困境相近' };
const body = (items: unknown[]) => JSON.stringify({ items });
const answer = () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: body([item]) } }] });
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('DEEPSEEK_API_KEY', 'test-only'); vi.stubEnv('DEEPSEEK_RECOMMEND_MODEL', ''); });
afterEach(() => vi.unstubAllEnvs());

describe('DeepSeek recommendation boundary', () => {
  it('validates identities and treats model reasons as suggestions, ignoring claimed credits/aliases', () => {
    const result = parseDeepSeekWorks(body([{ ...item, directors: ['模型虚构导演'] }, item,
      { ...item, title: '亲切的金子' }, { ...item, title: '成人', adult: true }, { ...item, title: '剧集', mediaType: 'tv' },
      { ...item, title: '假影片', year: 'oops' }]), seed, true);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ title: '老男孩', origin: 'ai', aliases: recommendationByTitle('老男孩', 2003)!.aliases, aiReason: item.reason });
    expect(result[0].aliases).not.toContain('不可信别名');
    expect(result[0].directors).not.toContain('模型虚构导演');
    expect(result[0].metadata?.rating).toBeTruthy();
    expect(result[0].metadata?.cast).toBeTruthy();
    const unknown = parseDeepSeekWorks(body([{ ...item, title: '数据库之外的测试片', aliases: ['老男孩'], directors: ['模型虚构导演'], cast: ['虚构主演'], genres: ['犯罪'],
      poster: 'https://fake.example/cover.jpg', metadata: { rating: '9.9', intro: '虚构简介' } }]), seed, true)[0];
    expect(unknown.title).toBe('数据库之外的测试片');
    expect(unknown.directors).toEqual([]); expect(unknown.cast).toEqual([]); expect(unknown.genres).toEqual([]);
    expect(unknown.metadata).toBeUndefined(); expect(unknown.poster).toBeUndefined();
  });
  it('does not call an external service without a credential', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', '');
    expect(await deepSeekRecommendations(seed, true, new AbortController().signal)).toEqual([]);
    expect(fetchUpstream).not.toHaveBeenCalled();
  });
  it('uses the fixed endpoint, JSON mode, bounded text-only input and a 24 hour cache', async () => {
    vi.mocked(fetchUpstream).mockResolvedValue(answer());
    await deepSeekRecommendations(seed, true, new AbortController().signal);
    const [url, options] = vi.mocked(fetchUpstream).mock.calls[0];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect(options).toMatchObject({ safeRedirects: false, redirect: 'error', timeoutMs: 25000 });
    expect(JSON.parse(options?.body as string)).toMatchObject({ model: 'deepseek-flash', max_tokens: 2200, response_format: { type: 'json_object' }, thinking: { type: 'disabled' } });
    expect(options?.body).not.toContain('test-only');
    expect(setCache).toHaveBeenCalledWith(expect.any(String), expect.any(Array), 86400000);
    vi.mocked(getCache).mockReturnValue([]);
    await deepSeekRecommendations(seed, true, new AbortController().signal);
    expect(fetchUpstream).toHaveBeenCalledTimes(1);
  });
  it.each(['', ' ', '{"items":', '{"items":"bad"}'])('rejects malformed/blank model output without caching it: %s', async text => {
    vi.mocked(fetchUpstream).mockResolvedValue(Response.json({ choices: [{ finish_reason: 'stop', message: { content: text } }] }));
    await expect(deepSeekRecommendations(seed, true, new AbortController().signal)).rejects.toThrow();
    expect(setCache).not.toHaveBeenCalled();
  });
  it('does not accept truncated JSON even if it looks parseable', async () => {
    vi.mocked(fetchUpstream).mockResolvedValue(Response.json({ choices: [{ finish_reason: 'length', message: { content: body([item]) } }] }));
    await expect(deepSeekRecommendations(seed, true, new AbortController().signal)).rejects.toThrow();
  });
  it('shares one paid call without aborting a second subscriber when the first leaves', async () => {
    let finish!: (r: Response) => void;
    vi.mocked(fetchUpstream).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const first = new AbortController(), second = new AbortController();
    const a = deepSeekRecommendations(seed, true, first.signal);
    const b = deepSeekRecommendations(seed, true, second.signal);
    first.abort(); await expect(a).rejects.toThrow();
    expect(vi.mocked(fetchUpstream).mock.calls[0][1]?.signal?.aborted).toBe(false);
    finish(answer()); expect(await b).toHaveLength(1);
    expect(fetchUpstream).toHaveBeenCalledTimes(1);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchUpstream } from '@/lib/fetch-utils';
import { parseFourKDetail } from './site-adapters';
import { parseFourKRelated, relatedSite } from './site-related';
import { parseBPRelated } from './baipiaozhe';

vi.mock('@/lib/fetch-utils', () => ({ fetchUpstream: vi.fn(), getCache: vi.fn(), setCache: vi.fn() }));
const source = { key: 'fourk', name: '4K影视', url: 'https://www.4kvm.tv' };
function card(id: string, title: string) {
  return `<a href="/play/${id}" data-vod="vod-${id}"><h3>${title}</h3><img src="https://img.example/${id}.jpg" alt="${title}"/></a>`;
}
function detail(id: string, title: string, type = '科幻', related = '') {
  return `<meta property="og:title" content="${title}"><meta property="og:image" content="https://img.example/${id}.jpg">
    <h1>${title}</h1><a data-line="1" data-episode="1" dataid="episode-${id}" href="/play/${id}"></a>
    <div class="col-span-1">导演</div><div class="col-span-2">郭帆</div>
    <div class="col-span-1">主演</div><div class="col-span-2">吴京 / 刘德华</div>
    <div class="col-span-1">类型</div><div class="col-span-2">${type}</div>
    <div class="col-span-1">上映</div><div class="col-span-2">2023-01-22</div>
    <div><div><h2>相关推荐</h2></div><div class="grid">${related}</div></div>`;
}
beforeEach(() => vi.resetAllMocks());

describe('website recommendations', () => {
  it('reads people and genres from detail rows, only cards under the related heading', () => {
    const html = card('advert', '广告') + detail('seed', '流浪地球', '动作 / 科幻', card('sequel', '流浪地球2') + card('sequel', '流浪地球2'));
    expect(parseFourKRelated(html, source).map(item => item.vodId)).toEqual(['sequel']);
    expect(parseFourKDetail(html, source).videoInfo).toMatchObject({ director: '郭帆', actor: '吴京 / 刘德华', typeName: '动作 / 科幻', year: '2023' });
    expect(parseFourKRelated(card('outside', '无推荐标题'), source)).toEqual([]);
  });
  it('enriches source/series candidates and uses existing ranking/filtering', async () => {
    vi.mocked(fetchUpstream).mockImplementation(async (url) => {
      const path = new URL(url).pathname;
      if (path === '/search') return new Response(card('seed', '流浪地球') + card('sequel', '流浪地球2'));
      if (path === '/play/seed') return new Response(detail('seed', '流浪地球', '科幻', card('other', '同导演电影') + card('adult', '敏感影片')));
      if (path === '/play/adult') return new Response(detail('adult', '敏感影片', '伦理片'));
      return new Response(detail(path.split('/').pop()!, path.endsWith('sequel') ? '流浪地球2' : '同导演电影'));
    });
    const result = await relatedSite(source, 'seed', true, new AbortController().signal);
    expect(result.partial).toBe(false);
    expect(result.items.map(item => item.vodId)).toEqual(['sequel', 'other']);
    expect(result.items[0]).toMatchObject({ sourceKey: 'fourk', sourceUrl: source.url, reasons: ['相近系列片名', '同导演 · 郭帆'] });
    expect(fetchUpstream).toHaveBeenCalledTimes(5);
  });
  it('retains valid candidates when one detail fails and bounds detail concurrency', async () => {
    let active = 0, maxActive = 0;
    vi.mocked(fetchUpstream).mockImplementation(async (url) => {
      const path = new URL(url).pathname;
      if (path === '/search') return new Response('');
      if (path === '/play/seed') return new Response(detail('seed', '流浪地球', '科幻', Array.from({ length: 20 }, (_, i) => card(`film${i}`, `作品${i}`)).join('')));
      active++; maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 1)); active--;
      if (path.endsWith('film0')) throw new Error('timeout');
      return new Response(detail(path.split('/').pop()!, path.split('/').pop()!));
    });
    const result = await relatedSite(source, 'seed', true, new AbortController().signal);
    expect(result.partial).toBe(true);
    expect(result.items).toHaveLength(7);
    expect(maxActive).toBeLessThanOrEqual(3);
    expect(fetchUpstream).toHaveBeenCalledTimes(10);
  });
  it('does not turn failed metadata requests into an empty success', async () => {
    vi.mocked(fetchUpstream).mockImplementation(async url => {
      if (new URL(url).pathname === '/play/seed') return new Response(detail('seed', '流浪地球', '科幻', card('other', '另一影片')));
      throw new Error('timeout');
    });
    await expect(relatedSite(source, 'seed', true, new AbortController().signal)).rejects.toThrow();
  });
  it('maps BP content kinds and retains genres/people while excluding inaccessible content', () => {
    const items = parseBPRelated([
      { id: '1', title: '电影', content_kind: 'movie', genres: ['动作', '科幻'], directors: ['导演'], actors: ['演员'] },
      { id: '2', title: '禁用', availability: { disabled: true } },
      { id: '3', title: '成人', is_adult: true },
      { id: '4', title: '不可播', availability: { playable: false } },
    ], source);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ typeName: '电影', genres: '动作 / 科幻', director: '导演', actor: '演员' });
  });
});

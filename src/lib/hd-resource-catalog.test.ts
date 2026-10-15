import { describe, it, expect, vi, beforeEach } from 'vitest';
import { downloadResource, parseResourceCatalog, parseResourceDetail, resourcePageUrl, getResourcePage } from './hd-resource-catalog';
import { HD_RESOURCE_SITES } from './hd-resource-sites';
vi.mock('./ssrf', () => ({ checkUpstreamAllowed: vi.fn(async () => ({ ok: true })) }));
const rr = 'https://www.rrdynb.com/';
const card = '<div class="stui-vodlist__box"><h4><a href="/movie/2026/1011/61793.html" title="长片名 4K HDR">片名</a></h4><p class="text-muted">1080P / 4K</p></div>';
beforeEach(() => { vi.unstubAllGlobals(); });
describe('four-site HD resource catalog', () => {
  it('keeps precisely the requested four sites, with Yinfans first', () => {
    expect(HD_RESOURCE_SITES.map(s => new URL(s.url).hostname.replace(/^www\./, ''))).toEqual(['yinfans.me', '1lou.me', 'rrdynb.com', 'hdzu.cc']);
  });
  it('extracts only article cards, deduplicates and rejects ads / foreign and malformed links', () => {
    const parsed = parseResourceCatalog('rrdynb', card + card + card.replace('/movie/2026/1011/61793.html','https://evil.example/movie/2026/1011/61793.html') + card.replace('/movie/2026/1011/61793.html','https://[') + '<a href="/plus/view.php?aid=1">注册广告</a>', rr);
    expect(parsed.items).toEqual([{ title: '长片名 4K HDR', url: rr + 'movie/2026/1011/61793.html', note: '1080P / 4K' }]);
  });
  it('supports observed RR category layout and relative next-page links', () => {
    const parsed = parseResourceCatalog('rrdynb', '<div class="intro"><h2><a href="/plus/view.php?aid=123" title="影片">影片<i>免费下载</i></a></h2><div class="brief">剧情</div></div><a href="list_2_2.html">下一页</a>', rr + 'movie/');
    expect(parsed.items[0].title).toBe('影片');
    expect(parsed.next).toBe(rr + 'movie/list_2_2.html');
  });
  it('parses known Yinfans article links without falling back to ordinary recommendations', () => {
    expect(parseResourceCatalog('yinfans', '<h2><a href="/movie/17742">片名 4K原盘</a></h2>', 'https://www.yinfans.me/').items).toHaveLength(1);
    expect(() => parseResourceCatalog('yinfans', '<title>Loading...</title><script>location="/jump-node"</script>', 'https://www.yinfans.me/')).toThrow('跳转页');
    expect(() => parseResourceCatalog('rrdynb', '<h1>网站维护中</h1>', rr)).toThrow('维护');
  });
  it('keeps valid forum resource links, excluding the forum index', () => {
    expect(parseResourceCatalog('1lou', '<div class="subject"><a title="最新电影" href="/forum-1-1.htm">电影</a><a class="text-title" href="/thread-123.htm">[BT下载][4K] 片名</a></div><div class="subject"><a title="站务专区">公告</a><a class="text-title" href="/thread-1.htm">公告</a></div><div class="subject"><a title="新美图区">美图</a><a class="text-title" href="/thread-2.htm">图片</a></div>', 'https://www.1lou.me/').items).toHaveLength(1);
  });
  it('rejects cross-site, credentials, unexpected endpoints and injected query parameters', () => {
    for (const url of ['https://evil.example/', 'https://www.rrdynb.com.evil.test/', 'https://user@www.rrdynb.com/', rr + 'member/login.php', rr + 'plus/view.php?aid=1&url=http://localhost', 'http://www.rrdynb.com/', 'https://127.0.0.1/']) {
      expect(resourcePageUrl('rrdynb', url, false)).toBeNull();
      expect(resourcePageUrl('rrdynb', url, true)).toBeNull();
    }
    expect(resourcePageUrl('rrdynb', rr + 'plus/view.php?aid=123', true)).toBe(rr + 'plus/view.php?aid=123');
  });
  it('extracts real resource types and preserves version, size, and extraction code', () => {
    const magnet = 'magnet:?xt=urn:btih:' + 'a'.repeat(40);
    const detail = parseResourceDetail('yinfans', `<h1>片名</h1><div class="entry-content"><table><tr><td>4K REMUX 54.7GB</td><td><a href="${magnet}">磁力</a></td></tr></table><p><a href="https://pan.baidu.com/s/xxx?pwd=abcd">百度网盘</a> 提取码：abcd</p><a href="https://cdn.example/movie.torrent">种子</a><a href="https://cdn.example/movie.mkv">MKV</a><script>evil()</script></div><a href="https://pan.baidu.com/s/ad">广告网盘</a>`, 'https://www.yinfans.me/movie/1');
    expect(detail.resources.map(r => r.kind)).toEqual(['磁力', '网盘', '种子', '文件']);
    expect(detail.resources[0].title).toContain('54.7GB');
    expect(detail.resources[1].title).toContain('abcd');
    expect(detail.summary).not.toContain('evil');
  });
  it('does not expose gated or unrelated download links as film resources', () => {
    const detail = parseResourceDetail('rrdynb', '<h1>会员片</h1><div class="movie-txt">这篇文档需要 注册会员 才能访问<a href="https://pan.quark.cn/s/ad">广告</a></div>', rr + 'plus/view.php?aid=1');
    expect(detail.loginRequired).toBe(true);
    expect(detail.resources).toEqual([]);
    for (const url of ['javascript:alert(1)', 'file:///movie.mp4', 'https://127.0.0.1/m.mp4', 'https://pan.baidu.com.evil.test/s/1', 'magnet:?xt=invalid']) expect(downloadResource(url, rr)).toBeNull();
  });
  it('rejects redirects outside the selected site before fetching a second URL', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'https://evil.example/' } }));
    vi.stubGlobal('fetch', fetcher);
    await expect(getResourcePage('rrdynb', rr + 'movie/list_2_12.html', false)).rejects.toThrow('跳转');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not cache failures, allowing a later retry to recover', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('maintenance', { status: 503 })).mockResolvedValueOnce(new Response(card));
    vi.stubGlobal('fetch', fetcher);
    const url = rr + 'movie/list_2_13.html';
    await expect(getResourcePage('rrdynb', url, false)).rejects.toThrow('503');
    await expect(getResourcePage('rrdynb', url, false)).resolves.toMatchObject({ items: [{ title: '长片名 4K HDR' }] });
  });
});

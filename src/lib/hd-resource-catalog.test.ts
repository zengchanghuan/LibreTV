import { describe, it, expect, vi, beforeEach } from 'vitest';
import { downloadResource, parseResourceCatalog, parseResourceDetail, resourcePageUrl, getResourcePage, resourceConnectionError } from './hd-resource-catalog';
import { HD_RESOURCE_SITES, ACTIVE_HD_RESOURCE_SITES } from './hd-resource-sites';
vi.mock('./ssrf', () => ({ checkUpstreamAllowed: vi.fn(async () => ({ ok: true })) }));
const rr = 'https://www.rrdynb.com/';
const card = '<div class="stui-vodlist__box"><h4><a href="/movie/2026/1011/61793.html" title="长片名 4K HDR">片名</a></h4><p class="text-muted">1080P / 4K</p></div>';
beforeEach(() => { vi.unstubAllGlobals(); });
describe('four-site HD resource catalog', () => {
  it('keeps precisely the requested four sites, with Yinfans first', () => {
    expect(HD_RESOURCE_SITES.map(s => new URL(s.url).hostname.replace(/^www\./, ''))).toEqual(['yinfans.me', '1lou.me', 'rrdynb.com', 'hdzu.org']);
  });
  it('only exposes the two working sources in the HD navigation', () => {
    expect(ACTIVE_HD_RESOURCE_SITES.map(site => site.id)).toEqual(['rrdynb', 'hdzu']);
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
    expect(() => parseResourceCatalog('yinfans', '<title>Loading...</title><script>location="/jump-node"</script>', 'https://www.yinfans.me/')).toThrow('关停公告');
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
  it('identifies Yinfans detail redirects to its retired homepage without following other domains', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'https://www.yinfans.me/' } }));
    vi.stubGlobal('fetch', fetcher);
    await expect(getResourcePage('yinfans', 'https://www.yinfans.me/movie/17742', true)).rejects.toMatchObject({ status: 410 });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('reports certificate mismatch and connection resets through nested fetch causes', () => {
    const tls = new Error('fetch failed', { cause: new AggregateError([Object.assign(new Error('mismatch'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' })]) });
    expect(resourceConnectionError('hdzu', tls).message).toContain('HTTPS 证书异常');
    const reset = new Error('fetch failed', { cause: { code: 'ECONNRESET' } });
    expect(resourceConnectionError('1lou', reset).message).toContain('一楼中断了服务器连接');
    expect(resourceConnectionError('1lou', new DOMException('aborted', 'TimeoutError')).message).toContain('超时');
  });
  it('can read a recovered Yinfans page instead of permanently disabling it', () => {
    expect(parseResourceCatalog('yinfans', '<h2><a href="/movie/17742">原站恢复后的片名</a></h2>', 'https://www.yinfans.me/').items).toHaveLength(1);
  });

  it('reads HDzone film cards, quality labels and load-more pages without sidebar links', () => {
    const cards = Array.from({ length: 20 }, (_, i) => `<li class="movie-item"><h2 class="topic-title"><a href="/t/${1000 + i}">影片${i}</a><span class="small">4K中英双字</span></h2></li>`).join('');
    const html = `<ul id="index-topic">${cards}</ul><div id="getmore">点击加载更多</div><h2><a href="/t/999">侧栏推荐</a></h2>`;
    const first = parseResourceCatalog('hdzu', html, 'https://hdzu.org/');
    expect(first.items).toHaveLength(20);
    expect(first.items[0]).toEqual({ title: '影片0', note: '4K中英双字', url: 'https://hdzu.org/t/1000' });
    expect(first.next).toBe('https://hdzu.org/?page=2');
    expect(parseResourceCatalog('hdzu', html, 'https://hdzu.org/?page=2').next).toBe('https://hdzu.org/?page=3');
    expect(parseResourceCatalog('hdzu', `<ul id="index-topic">${cards.split('</li>')[0]}</li></ul><div id="getmore"></div>`, 'https://hdzu.org/').next).toBeUndefined();
  });
  it('limits HDzone requests to its verified domain and movie/page paths', () => {
    expect(resourcePageUrl('hdzu', '/t/1005041', true)).toBe('https://hdzu.org/t/1005041');
    expect(resourcePageUrl('hdzu', '/?page=2', false)).toBe('https://hdzu.org/?page=2');
    for (const url of ['https://hdzu.cc/', 'https://hdzu.org.evil.test/', '/message/send', '/?page=-1', '/?page=2&url=https://evil.test', '/?page=0', '/t/123?redirect=x']) {
      expect(resourcePageUrl('hdzu', url, true)).toBeNull();
      expect(resourcePageUrl('hdzu', url, false)).toBeNull();
    }
  });
  it('extracts HDzone download rows with quality and size, excluding controls and unrelated links', () => {
    const magnet = 'magnet:?xt=urn:btih:' + 'b'.repeat(40);
    const detail = parseResourceDetail('hdzu', `<div class="sidebar-left"><div class="topic"><div class="panel-body"><h1>示例影片<small>4K中英双字</small></h1><div class="topic-content">影片介绍<a href="https://pan.baidu.com/s/ad">推广</a></div><div class="movie-url"><table><tr><td>4K</td><td><a href="${magnet}">[78.07GB]示例.UHD.Blu-ray.HDR10</a></td><td><button>复制</button><button>云播</button></td></tr></table></div></div></div></div><aside><a href="https://pan.quark.cn/s/ad">广告</a></aside>`, 'https://hdzu.org/t/1005041');
    expect(detail.title).toBe('示例影片 4K中英双字');
    expect(detail.resources).toEqual([{ kind: '磁力', url: magnet, title: '4K [78.07GB]示例.UHD.Blu-ray.HDR10' }]);
    expect(detail.summary).not.toContain('78.07GB');
    expect(detail.loginRequired).toBe(false);
  });

  it('honors HDzone login restrictions inside the download section', () => {
    const detail = parseResourceDetail('hdzu', '<div class="sidebar-left"><div class="topic"><div class="panel-body"><h1>会员影片</h1><div class="topic-content">公开简介</div><div class="movie-url">登录后查看下载地址<a href="https://pan.quark.cn/s/hidden">下载</a></div></div></div></div>', 'https://hdzu.org/t/42');
    expect(detail.loginRequired).toBe(true);
    expect(detail.resources).toEqual([]);
  });

});

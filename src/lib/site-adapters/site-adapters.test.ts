import { describe, expect, it } from 'vitest';
import { parseFourKDetail, parseFourKSearch, selectFourKPlayback, siteAdapterFor, validSiteId } from './site-adapters';
import { parseBPSearch, selectBPPlayback } from './baipiaozhe';
const source = { key: 'env_11', name: '4K影视', url: 'https://www.4kvm.tv' };
describe('website adapters', () => {
  it('matches only exact HTTPS site roots', () => {
    expect(siteAdapterFor(source.url)).toBe('4kvm');
    expect(siteAdapterFor('https://baipiaozhe.ai/')).toBe('baipiaozhe');
    for (const url of ['https://4kvm.tv.evil.org', 'https://user@4kvm.tv', 'http://4kvm.tv', 'https://4kvm.tv:444', 'https://4kvm.tv/api', 'https://baipiaozhe.ai/?q=x']) expect(siteAdapterFor(url)).toBeNull();
    for (const id of ['../secret', 'abc?x=y', 'a'.repeat(513), '']) expect(validSiteId(id)).toBe(false);
  });
  it('parses and deduplicates HTML cards and entity-encoded posters', () => {
    const card = '<a href="/play/abc12" data-vod="v1"><img data-src="https://img.test/a?x=1&amp;y=2" alt="电影"><h3>电影 &amp; 梦</h3><span>2010</span></a>';
    const items = parseFourKSearch(card + card + '<a href="/play/../../x" data-vod="x"><h3>bad</h3></a>', source);
    expect(items).toHaveLength(1); expect(items[0]).toMatchObject({ name: '电影 & 梦', year: '2010', pic: 'https://img.test/a?x=1&y=2', sourceKey: 'env_11' });
    expect(parseFourKSearch('<div>暂无结果</div>', source)).toEqual([]);
  });
  it('keeps first-line episode order without duplicates across lines', () => {
    const html = '<meta property="og:title" content="测试剧 - 第2集">' + [[1,1,'a'],[1,2,'b'],[2,1,'c']].map(([line,ep,id]) => `<a data-line="${line}" data-episode="${ep}" dataid="123" href="/play/${id}"></a>`).join('');
    const detail = parseFourKDetail(html, source);
    expect(detail.episodes).toEqual(['/api/site-playback?site=4kvm&id=a', '/api/site-playback?site=4kvm&id=b']);
    expect(detail.videoInfo.title).toBe('测试剧');
    expect(() => parseFourKDetail('format changed', source)).toThrow();
  });
  it('never selects locked or VIP-only 4K playback', () => {
    expect(selectFourKPlayback({ code: 200, data: { quality_urls: [{ isvip:true, url:'https://example.org/vip.mp4' }, { locked:true, url:'https://example.org/locked.mp4' }, { url:'https://example.org/free.mp4', mtype:'mp4' }] } })).toEqual({url:'https://example.org/free.mp4',type:'mp4'});
    expect(() => selectFourKPlayback({ code:200, data:{quality_urls:[{isvip:true,url:'https://example.org/vip.mp4'}]}})).toThrow();
  });
  it('filters unavailable/adult BP results and refuses paid resolver lines', () => {
    expect(parseBPSearch([{id:'av_1',title:'电影'},{id:'av_2',title:'不可用',availability:{playable:false}},{id:'av_3',title:'成人',content_kind:'adult'}], source)).toHaveLength(1);
    expect(selectBPPlayback([{url:'resolve://ticket',resolve_required:true},{url:'https://example.org/vip.m3u8',minimum_user_level:2},{url:'https://example.org/free.m3u8'}])).toEqual({url:'https://example.org/free.m3u8',type:'m3u8'});
    expect(() => selectBPPlayback([{url:'resolve://ticket',resolve_mode:'parse'}])).toThrow();
  });
});

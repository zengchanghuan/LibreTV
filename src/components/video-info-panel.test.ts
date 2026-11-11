import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { VideoInfoPanel, videoInfoSummary } from './video-info-panel';
import type { VideoInfo } from '@/lib/types';
const info: VideoInfo = { title: '出租车司机', year: '2017', area: '韩国', typeName: '剧情片', genre: '剧情', remarks: '高清', director: '张勋', actor: '宋康昊 / 柳海真 / 柳俊烈 / 朴赫权', rating: { source: 'IMDb', value: '7.9', url: 'https://www.imdb.com/title/tt6878038/' }, originalTitle: '택시운전사', aliases: ['逆權司機'], sourceKey: 'test', sourceName: 'test' };
describe('film info presentation', () => {
  it.each([false, true])('shows rating with provenance and basic metadata in compact=%s', compactOnMobile => {
    const html = renderToStaticMarkup(createElement(VideoInfoPanel, { info, compactOnMobile }));
    expect(html).toContain('IMDb评分'); expect(html).toContain('7.9'); expect(html).toContain('https://www.imdb.com/title/tt6878038/');
    expect(html).toContain('宋康昊 · 柳海真 · 柳俊烈'); expect(html).not.toContain('朴赫权');
    expect(html).toContain('更多资料'); expect(html).toContain('택시운전사'); expect(html).toContain('逆權司機');
    expect(html).not.toContain('高清'); expect(html).not.toContain('片长');
    expect(videoInfoSummary(info)).toBe('2017 · 韩国 · 剧情');
  });
  it('shows missing rating honestly and rejects executable source links', () => {
    expect(renderToStaticMarkup(createElement(VideoInfoPanel, { info: { ...info, rating: undefined } }))).toContain('暂无评分');
    expect(renderToStaticMarkup(createElement(VideoInfoPanel, { info: { ...info, rating: { value: '8.0', source: 'IMDb', url: 'javascript:alert(1)' } } }))).not.toContain('javascript:');
  });
});

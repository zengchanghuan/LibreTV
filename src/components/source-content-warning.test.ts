import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SourceContentWarning } from './source-content-warning';
import { AggregatedCard } from './video-card';
import { aggregateResults } from '@/lib/search-result-groups';
import { sourceContentIssue } from '@/lib/source-content-corrections';

describe('quarantined source presentation', () => {
  it('shows an explicit warning for old watch links and changed media URLs', () => {
    const issue = sourceContentIssue('https://360zy.com/api.php/provide/vod', '8737');
    const html = renderToStaticMarkup(createElement(SourceContentWarning, { issue }));
    expect(html).toContain('内容不符 · 已隔离');
    expect(html).toContain('仍可手动播放');
    expect(html).toContain('未经确认的海报、年份和影片资料已隐藏');
    const changed = sourceContentIssue('https://360zy.com/api.php/provide/vod', '8737', ['https://cdn.example/new.m3u8']);
    expect(renderToStaticMarkup(createElement(SourceContentWarning, { issue: changed }))).toContain('播放地址已变化 · 待重新核实');
    expect(renderToStaticMarkup(createElement(SourceContentWarning, {}))).toBe('');
  });
  it('keeps the search card clickable without displaying the Korean poster as its identity', () => {
    const [group] = aggregateResults([{ sourceKey: 'env_3', sourceName: '360资源', sourceUrl: 'https://360zy.com/api.php/provide/vod',
      vodId: '8737', name: '局内人', year: '2015', typeName: '剧情片', pic: 'https://img.example/wrong-poster.jpg' }]);
    const html = renderToStaticMarkup(createElement(AggregatedCard, { group, onOpen: () => {} }));
    expect(html).toContain('role="button"');
    expect(html).toContain('归属待确认');
    expect(html).toContain('源站资料与实际视频不符');
    expect(html).not.toContain('wrong-poster.jpg');
    expect(html).toContain('片源原始资料');
  });
});

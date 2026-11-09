import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HomeFeedbackButtons } from './home-feedback';

describe('feedback icon states', () => {
  it('exposes independent actions and selected/undo labels to screen readers', () => {
    const html = renderToStaticMarkup(createElement(HomeFeedbackButtons, { title: '测试影片', value: 'like', disabled: false, pending: false, onVote: () => {} }));
    expect(html).toContain('取消点赞《测试影片》');
    expect(html).toContain('点踩《测试影片》');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toContain('已赞');
  });
  it('disables both actions during saves and preserves the last confirmed vote', () => {
    const html = renderToStaticMarkup(createElement(HomeFeedbackButtons, { title: '测试影片', value: 'dislike', disabled: true, pending: true, onVote: () => {} }));
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('取消点踩《测试影片》');
    expect(html).toContain('保存中');
  });
});

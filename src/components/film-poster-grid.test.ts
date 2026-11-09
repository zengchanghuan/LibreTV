import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FilmPosterGrid } from './film-poster-grid';

describe('curated list common titles', () => {
  it('shows the common Chinese title while retaining the source list title, year and original poster', () => {
    const html = renderToStaticMarkup(createElement(FilmPosterGrid, {
      films: [{ id: 'masquerade', title: '光海，成为王的男人', year: 2012, mediaType: 'movie' }], onPick: () => {},
    }));
    expect(html).toContain('搜索《双面君王》');
    expect(html).toContain('榜单原名：光海，成为王的男人');
    expect(html).toContain('2012'); expect(html).toContain('李秉宪');
    expect(html).toContain('7e4e7f28fcaada76');
  });
});

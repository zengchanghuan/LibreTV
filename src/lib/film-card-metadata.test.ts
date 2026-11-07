import { describe, expect, it } from 'vitest';
import { filmPosterUrl, filmRatingUrl, mergeFilmMetadata, recommendationCardInfo } from './film-card-metadata';
import { catalogIdentity } from './recommendation-catalog';
import { getFilmPosterMetadata } from './film-poster-metadata';
import { seedWork } from './recommendations';

const work = seedWork({ title: '老男孩', year: '2003', sourceKey: '', sourceName: '' });
describe('shared recommendation card metadata', () => {
  it('carries the global rating, credits, introduction and poster into recommendations', () => {
    const fixture = { ...work, title: '生死谍变', year: '1999' };
    const global = getFilmPosterMetadata(fixture.title, 1999)!;
    const known = catalogIdentity(fixture)!;
    expect(known.metadata).toMatchObject(global);
    expect(recommendationCardInfo(known).metadata).toMatchObject(global);
    expect(global.rating).toBeTruthy(); expect(global.intro).toBeTruthy(); expect(global.cast).toBeTruthy();
  });
  it('preserves curated values, skips empty placeholders and fills remaining fields', () => {
    expect(mergeFilmMetadata({ director: '全局导演', cast: '未知', intro: ' ' }, { director: '片源导演', cast: '片源主演', intro: '简介' }))
      .toEqual({ director: '全局导演', cast: '片源主演', intro: '简介' });
    const info = recommendationCardInfo({ ...work, metadata: { rating: '8.2', poster: '/posters/local.jpg' } }, [
      { name: '老男孩', vodId: '1', sourceKey: 'a', sourceName: 'A', sourceUrl: 'https://a.example/api/', pic: '/cover.jpg', metadata: { cast: '演员', poster: 'https://a.example/cover.jpg' } },
      { name: '老男孩', vodId: '2', sourceKey: 'a', sourceName: 'A', sourceUrl: 'https://a.example/api/', pic: 'javascript:alert(1)' },
    ]);
    expect(info.metadata).toMatchObject({ rating: '8.2', cast: '演员' });
    expect(info.posters).toEqual(['/posters/local.jpg', 'https://a.example/cover.jpg']);
    expect(info.sourceCount).toBe(1);
  });
  it('accepts local/HTTP posters but rejects executable URLs and credentials', () => {
    expect(filmPosterUrl('/posters/a.jpg')).toBe('/posters/a.jpg');
    expect(filmPosterUrl('//images.example/a.jpg', 'https://source.example/')).toBe('https://images.example/a.jpg');
    for (const value of ['javascript:alert(1)', 'data:image/svg+xml,abc', 'https://user:password@a.example/a.jpg', '//a.example/a.jpg']) {
      expect(filmPosterUrl(value)).toBeUndefined();
    }
  });
  it('links ratings only to the matching known rating provider', () => {
    expect(filmRatingUrl({ ratingSource: '豆瓣', doubanId: '123' })).toBe('https://movie.douban.com/subject/123/');
    expect(filmRatingUrl({ ratingSource: 'IMDb', source: 'https://www.imdb.com/title/tt123/' })).toBe('https://www.imdb.com/title/tt123/');
    expect(filmRatingUrl({ ratingSource: '豆瓣', source: 'https://www.themoviedb.org/movie/123' })).toBeUndefined();
  });
});

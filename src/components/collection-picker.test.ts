import { describe, expect, it } from 'vitest';
import { filterCollections } from './collection-picker';

describe('mobile collection search', () => {
  const options = [
    { id: 'grand-slam', name: '韩国大满贯' },
    { id: 'box-office', name: '韩国电影观影人次 TOP 30' },
    { id: 'zhangyan', name: '张燕版韩国政治惊悚片' },
    { id: 'director', name: '奉俊昊', fullName: '奉俊昊 Bong Joon-ho' },
  ];
  it('keeps source order and full screenshot titles when filtering', () => {
    expect(filterCollections(options, ' 韩国 ')).toEqual(options.slice(0, 3));
    expect(filterCollections(options, '')).toEqual(options);
    expect(filterCollections(options, '张燕版韩国政治惊悚片')).toEqual([options[2]]);
  });
  it('accepts full-width Latin input and alternate full names', () => {
    expect(filterCollections(options, 'ｔｏｐ ３０')).toEqual([options[1]]);
    expect(filterCollections(options, 'bong')).toEqual([options[3]]);
  });
  it('returns an empty list for an unknown title without changing the source', () => {
    expect(filterCollections(options, '不存在的片单')).toEqual([]);
    expect(options).toHaveLength(4);
  });
});

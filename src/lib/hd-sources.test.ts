import { describe, expect, it } from 'vitest';
import { sourcesForSection, searchPageUrl } from './hd-sources';
import { buildWatchUrl } from './utils';
import type { SourceConfig } from './types';
const sources: SourceConfig[] = [
  { key: 'hd', name: '精选源', url: 'https://a.example', group: 'hd' },
  { key: 'ordinary', name: '4K宣传名', url: 'https://b.example' },
  { key: 'adult', name: '成人', url: 'https://c.example', group: 'hd', isAdult: true },
];
describe('HD section', () => {
  it('uses explicit curation and excludes adult sources, not name matching', () => {
    expect(sourcesForSection(sources, 'hd').map(s => s.key)).toEqual(['hd']);
    expect(sourcesForSection(sources, 'all')).toEqual(sources);
  });
  it('does not restore disabled or unselected sources', () => {
    expect(sourcesForSection(sources.slice(1), 'hd')).toEqual([]);
  });
  it('keeps searches inside their section and encodes queries', () => {
    expect(searchPageUrl('hd', '4K & 中文')).toBe('/hd?s=4K%20%26%20%E4%B8%AD%E6%96%87');
    expect(searchPageUrl('all', 'test')).toBe('/?s=test');
  });
  it('carries HD context to the player without changing ordinary links', () => {
    expect(buildWatchUrl({ sourceKey: 'hd', vodId: '1', section: 'hd' })).toContain('section=hd');
    expect(buildWatchUrl({ sourceKey: 'normal', vodId: '1' })).not.toContain('section=');
  });
});

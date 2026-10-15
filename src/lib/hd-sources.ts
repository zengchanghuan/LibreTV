import type { SourceConfig } from './types';

export function sourcesForSection(sources: SourceConfig[], section: 'all' | 'hd'): SourceConfig[] {
  return section === 'hd' ? sources.filter(source => source.group === 'hd' && !source.isAdult) : sources;
}

export function searchPageUrl(section: 'all' | 'hd', query: string): string {
  return `${section === 'hd' ? '/hd' : '/'}?s=${encodeURIComponent(query)}`;
}

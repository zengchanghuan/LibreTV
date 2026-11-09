import type { SourceConfig } from './types';
import type { SearchContext } from './work-search';

export function sourcesForSection(sources: SourceConfig[], section: 'all' | 'hd'): SourceConfig[] {
  return section === 'hd' ? sources.filter(source => source.group === 'hd' && !source.isAdult) : sources;
}

export function searchPageUrl(section: 'all' | 'hd', query: string, context?: SearchContext): string {
  const extra = Object.entries(context || {}).filter(([, value]) => value).map(([key, value]) => `&${key}=${encodeURIComponent(value!)}`).join('');
  return `${section === 'hd' ? '/hd' : '/'}?s=${encodeURIComponent(query)}${extra}`;
}

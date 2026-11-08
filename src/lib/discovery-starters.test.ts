import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { recommendationCatalog } from './recommendation-catalog';
import { discoveryStarters } from './discovery-starters';

describe('bundled discovery starters', () => {
  it('uses distinct catalog films with shipped covers, without network or watch-count prerequisites', () => {
    expect(new Set(discoveryStarters.map(w => w.id)).size).toBe(9);
    for (const work of discoveryStarters) {
      const known = recommendationCatalog.find(w => w.id === work.id);
      expect(known?.title).toBe(work.title);
      expect(known?.year).toBe(work.year);
      expect(known?.poster).toBe(work.poster);
      expect(existsSync(join(process.cwd(), 'public', work.poster!))).toBe(true);
    }
  });
});

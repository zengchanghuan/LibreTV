import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEnvSources } from './env-sources';
afterEach(() => vi.unstubAllEnvs());
describe('HD source presets', () => {
  it('preserves existing keys and explicit HD membership', () => {
    vi.stubEnv('DEFAULT_SOURCES', JSON.stringify([
      { name: 'existing', url: 'https://a.example' },
      { name: 'new', url: 'https://b.example', group: 'hd' },
      { name: 'unknown', url: 'https://c.example', group: '4k' },
    ]));
    const result = getEnvSources();
    expect(result.map(s => s.key)).toEqual(['env_0', 'env_1', 'env_2']);
    expect(result[0].group).toBeUndefined();
    expect(result[1].group).toBe('hd');
    expect(result[2].group).toBeUndefined();
  });
});

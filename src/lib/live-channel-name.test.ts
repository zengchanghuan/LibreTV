import { describe, expect, it } from 'vitest';
import { cleanLiveChannelName, liveChannelNameLines } from './live-channel-name';

describe('live channel names', () => {
  it('shows only the bilingual titles from an existing cached subscription', () => {
    expect(liveChannelNameLines('BBC News (1080p) [Not 24/7;Geo-blocked] ｜ BBC新闻频道')).toEqual(['BBC News', 'BBC新闻频道']);
    expect(cleanLiveChannelName('湖南卫视 4K（HEVC）')).toBe('湖南卫视');
  });
  it('preserves station numbers, regional identity, and meaningful parentheses', () => {
    for (const name of ['France 24', 'Channel 4', 'BBC One', '3ABN Canada', 'ABC (Australia)']) {
      expect(cleanLiveChannelName(name)).toBe(name);
    }
  });
  it('does not repeat identical titles or create blank lines', () => {
    expect(liveChannelNameLines('CCTV-1 ｜ CCTV-1')).toEqual(['CCTV-1']);
    expect(liveChannelNameLines('CCTV-1')).toEqual(['CCTV-1']);
  });
});

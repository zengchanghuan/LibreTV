import { describe, expect, it } from 'vitest';
import { compareSourcePreference, mediaPreferenceLabel, type SourcePreference } from './source-preference';
import type { MediaProbe } from './media-probe';
const probe = (fields: Partial<MediaProbe> = {}): MediaProbe => ({ ok: true, ms: 500, kbps: 10000, episodes: 1, ...fields });
const order = (items: Record<string, SourcePreference>) => Object.entries(items).sort((a, b) => compareSourcePreference(a[1], b[1])).map(([key]) => key);
describe('point-of-play resource ranking', () => {
  it('ranks usable HD with verified subtitles first; failures last despite claims', () => {
    expect(order({ failed: { probe: probe({ ok: false, height: 2160, subtitles: 'verified' }) },
      unknown: {}, fast: { probe: probe({ ms: 30, kbps: 50000 }) },
      preferred: { probe: probe({ height: 1080, subtitles: 'verified', subtitleLanguage: 'zh' }) }
    })).toEqual(['preferred', 'fast', 'unknown', 'failed']);
  });
  it('demotes HD whose sampled speed cannot sustain its bitrate', () => {
    expect(order({ slow: { probe: probe({ height: 2160, subtitles: 'verified', bandwidth: 20000000 }) },
      fast: { probe: probe() } })).toEqual(['fast', 'slow']);
  });
  it('uses measured speed within the same HD/subtitle tier', () => {
    expect(order({ slow: { probe: probe({ height: 1080, subtitles: 'verified', ms: 2000, kbps: 3000 }) },
      fast: { probe: probe({ height: 1080, subtitles: 'verified' }) } })).toEqual(['fast', 'slow']);
  });
  it('does not mistake a declared track or a source label for verified subtitles', () => {
    expect(order({ declared: { probe: probe({ height: 1080, subtitles: 'declared' }), remarks: '4K 中字' },
      verified: { probe: probe({ height: 1080, subtitles: 'verified' }) } })).toEqual(['verified', 'declared']);
    expect(mediaPreferenceLabel(probe(), '1080p 中字')).toContain('片源标注');
    expect(mediaPreferenceLabel(probe())).toContain('字幕未确认');
  });
  it('prefers Chinese subtitles and does not reuse another film probe from source history', () => {
    expect(order({ english: { probe: probe({ height: 1080, subtitles: 'verified', subtitleLanguage: 'en' }) },
      chinese: { probe: probe({ height: 1080, subtitles: 'verified', subtitleLanguage: 'zh-Hant' }) }
    })).toEqual(['chinese', 'english']);
    const history = { at: Date.now(), starts: 0, playedMs: 0, stalledMs: 0, stalls: 0, probe: { at: Date.now(), ok: true, ms: 1 } };
    expect(compareSourcePreference({ history }, {})).toBe(0);
  });
  it('keeps equally unknown sources stable and penalizes observed stalling', () => {
    expect(compareSourcePreference({}, {})).toBe(0);
    const history = { at: Date.now(), starts: 1, startupMs: 100, playedMs: 10000, stalledMs: 20000, stalls: 5 };
    expect(order({ stalled: { probe: probe({ height: 1080, subtitles: 'verified' }), history }, good: { probe: probe() } })).toEqual(['good', 'stalled']);
  });
});

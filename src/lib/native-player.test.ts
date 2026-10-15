import { describe, expect, it } from 'vitest';
import { parseNativeProgress } from './native-player';
const event = { eventId: 'event', sessionId: 'session', profileId: null, sourceKey: 'source', vodId: 'video', title: '标题', index: 1, total: 3, position: 120, duration: 1800, sequence: 3, baseRevision: 0, openedAt: 1, ended: false, reason: 'progress' };
describe('native bridge boundary', () => {
  it('accepts a valid bounded playback event', () => expect(parseNativeProgress(event)).toEqual(event));
  it.each([{ position: Infinity }, { duration: -1 }, { index: 3 }, { sequence: 2.2 }, { total: 10001 }, { sourceUrl: 'javascript:alert(1)' }, { profileId: 'other' }, { reason: 'unknown' }])('rejects malformed native payload %o', change => expect(parseNativeProgress({ ...event, ...change })).toBeNull());
});

import { describe, expect, it } from 'vitest';
import type { HistoryEntry } from './db';
import { continueWatching } from './home-continue';

const entry: HistoryEntry = { id: 'a_1', sourceKey: 'a', vodId: '1', title: '测试',
  episodeIndex: 0, totalEpisodes: 1, playbackPosition: 150, duration: 300, timestamp: 1 };
describe('continue watching', () => {
  it('hides completed films and very short visits, retaining unknown-duration progress', () => {
    expect(continueWatching([{ ...entry, playbackPosition: 295 }, { ...entry, playbackPosition: 5 }])).toEqual([]);
    expect(continueWatching([{ ...entry, duration: 0 }])[0].playbackPosition).toBe(150);
  });
  it('offers the next episode instead of marking a whole series complete', () => {
    expect(continueWatching([{ ...entry, playbackPosition: 290, totalEpisodes: 10 }])[0]).toMatchObject({ episodeIndex: 1, playbackPosition: 0, nextEpisode: true });
    expect(continueWatching([{ ...entry, playbackPosition: 290, totalEpisodes: 10, episodeIndex: 9 }])).toEqual([]);
  });
  it('returns only the two newest entries from the supplied member database', () => {
    expect(continueWatching([entry, { ...entry, id: 'b', timestamp: 3 }, { ...entry, id: 'c', timestamp: 2 }]).map(i => i.id)).toEqual(['b', 'c']);
  });
});

import type { HistoryEntry } from './db';

/** Finish a movie, hide it; finish an episode, offer the next one. Unknown duration stays resumable. */
export function continueWatching(entries: HistoryEntry[]) {
  return [...entries].sort((a, b) => b.timestamp - a.timestamp).flatMap(item => {
    if (!Number.isFinite(item.playbackPosition) || item.playbackPosition < 10) return [];
    const complete = item.duration > 0 && item.playbackPosition >= item.duration * 0.95;
    if (complete && item.episodeIndex + 1 >= item.totalEpisodes) return [];
    return [{ ...item, episodeIndex: item.episodeIndex + (complete ? 1 : 0),
      playbackPosition: complete ? 0 : item.playbackPosition, duration: complete ? 0 : item.duration,
      nextEpisode: complete }];
  }).slice(0, 2);
}

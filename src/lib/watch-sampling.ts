export interface PlaybackSample { at: number; position: number; playing: boolean; seeking: boolean; ready: boolean; rate: number }
/** Count real elapsed watching time, never the distance covered by a seek. */
export function watchedSeconds(previous: PlaybackSample | undefined, current: PlaybackSample): number {
  if (!previous || !previous.playing || !current.playing || previous.seeking || current.seeking || !previous.ready || !current.ready) return 0;
  const elapsed = (current.at - previous.at) / 1000, moved = current.position - previous.position;
  if (elapsed <= 0 || elapsed > 3 || moved <= 0 || moved > elapsed * Math.max(previous.rate, current.rate, 1) + .75) return 0;
  return Math.min(elapsed, moved / Math.max(.25, current.rate));
}

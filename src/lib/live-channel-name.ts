/** Stream quality/status belongs to diagnostics, not the channel title. */
export function cleanLiveChannelName(name: string): string {
  return name
    .replace(/\s*[（(\[]\s*(?:\d{2,4}[pi]|[248]K|U?HD|SD|HEVC|H[. ]?26[45]|(?:Geo-blocked|Not 24\/7)(?:;\s*(?:Geo-blocked|Not 24\/7))*)\s*[）)\]]/gi, '')
    .replace(/\s+(?:[248]K|U?HD|SD|HEVC|H[. ]?26[45])(?=\s*$)/gi, '')
    .replace(/\s+/g, ' ').trim();
}

export function liveChannelNameLines(name: string): string[] {
  return [...new Set(name.split('｜').map(cleanLiveChannelName).filter(Boolean))];
}

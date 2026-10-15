/** Legacy clients stored only stream URLs; keep accepting them during migration. */
export interface LiveFavoriteChannel {
  url: string;
  sourceUrl?: string;
  tvgId?: string;
}
export type LiveFavorite = string | LiveFavoriteChannel;

export function favoriteRecord(favorite: LiveFavorite): LiveFavoriteChannel {
  const value = typeof favorite === 'string' ? { url: favorite } : favorite;
  return { url: value.url, ...(value.sourceUrl && value.tvgId
    ? { sourceUrl: value.sourceUrl, tvgId: value.tvgId } : {}) };
}

function identity(channel: LiveFavoriteChannel): string | undefined {
  return channel.sourceUrl && channel.tvgId ? JSON.stringify([channel.sourceUrl, channel.tvgId]) : undefined;
}

export function resolveLiveFavorite(favorite: LiveFavorite, channels: readonly LiveFavoriteChannel[]): LiveFavoriteChannel | undefined {
  const record = favoriteRecord(favorite);
  const key = identity(record);
  const candidates = channels.filter((channel) => key ? identity(channel) === key : channel.url === record.url);
  // Preserve a selected rendition while it exists. If it disappears, only move
  // when the replacement is unambiguous within the original subscription.
  return candidates.find((channel) => channel.url === record.url)
    ?? (candidates.length === 1 ? candidates[0] : undefined);
}

export function liveFavoriteUrls(favorites: readonly LiveFavorite[], channels: readonly LiveFavoriteChannel[]): Set<string> {
  return new Set(favorites.flatMap((favorite) => {
    const channel = resolveLiveFavorite(favorite, channels);
    return channel ? [channel.url] : [];
  }));
}

export function reconcileLiveFavorites(
  favorites: readonly LiveFavorite[], channels: readonly LiveFavoriteChannel[], recent: readonly LiveFavoriteChannel[],
): LiveFavoriteChannel[] {
  return favorites.map((favorite) => {
    let record = favoriteRecord(favorite);
    if (!identity(record)) {
      // Old favorites may already have a new URL; watch history can still carry
      // their original subscription/id. Do not infer identity from the title.
      for (const evidence of [recent, channels]) {
        const matching = evidence.filter((c) => c.url === record.url && identity(c));
        if (matching.length && new Set(matching.map(identity)).size === 1) {
          record = favoriteRecord(matching[0]);
          break;
        }
      }
    }
    const resolved = resolveLiveFavorite(record, channels);
    return resolved ? { ...record, url: resolved.url } : record;
  }).filter((record, index, all) => all.findIndex((other) =>
    other.url === record.url && identity(other) === identity(record)) === index);
}

export function toggleLiveFavorite(favorites: readonly LiveFavorite[], channel: LiveFavorite): LiveFavorite[] {
  const record = favoriteRecord(channel);
  if (favorites.some((favorite) => favoriteRecord(favorite).url === record.url)) {
    return favorites.filter((favorite) => favoriteRecord(favorite).url !== record.url);
  }
  // An explicit selection can resolve an ambiguous replacement left pending.
  const key = identity(record);
  return [...favorites.filter((favorite) => !key || identity(favoriteRecord(favorite)) !== key), record];
}

import { createHash } from 'node:crypto';
import { recommendationCatalog, catalogIdentity, recommendationByTitle } from './recommendation-catalog';
import { filmCollections, koreanModernHistory } from './film-collections';
import { peopleCollections } from './people-collections';
import { chungmuroCollection } from './chungmuro-collection';
import { koreanBoxOfficeCollection } from './korean-box-office-collection';
import { isAdultContent } from './cms-parser';
import { seriesQuery } from './related-videos';
import type { RecommendedWork } from './recommendations';
import { homeDay, type HomeRecommendations } from './home-discovery-types';
import type { HomePreference } from './home-feedback-types';
import { homePreferenceScore, homePreferenceFilter } from './home-preferences';

export const homeCatalogVersion = createHash('sha256').update(JSON.stringify(recommendationCatalog)).digest('hex').slice(0, 12) + '-v2';
const collections = [koreanBoxOfficeCollection, chungmuroCollection, koreanModernHistory, ...filmCollections, ...peopleCollections];
const inCollections = new Set(collections.flatMap(c => c.sections.flatMap(s => s.films.map(([t, y]) => `${t}|${y}`))));

function hash(text: string) {
  let value = 2166136261;
  for (const c of text) value = Math.imul(value ^ c.charCodeAt(0), 16777619);
  return value >>> 0;
}
export function eligibleHomeWork(work: RecommendedWork, filterAdult: boolean) {
  return /^(18|19|20)\d{2}$/.test(work.year) && Boolean(work.poster && work.metadata?.source)
    && (!work.metadata?.rating || Number(work.metadata.rating) >= 7)
    && !['tv', 'variety'].includes(work.mediaType)
    && [work.title, ...work.aliases].some(title => inCollections.has(`${title}|${work.year}`))
    && (!filterAdult || (!/情色|色情|成人|倫理|伦理/.test(work.metadata?.genre || work.genres.join(','))
      && !isAdultContent(`${work.title},${work.metadata?.genre || ''},${work.genres.join(',')}`)));
}

/** AI chooses candidates, but all identities, credits and posters come from our verified catalog. */
export function verifiedHomeAI(items: RecommendedWork[], filterAdult: boolean) {
  return items.flatMap(item => {
    const known = catalogIdentity({ ...item, aliases: [] });
    if (!known || !eligibleHomeWork(known, filterAdult) || !item.aiReason) return [];
    return [{ ...known, origin: 'ai' as const, aiReason: item.aiReason,
      reasons: [item.aiReason] }];
  });
}

export function buildHomeRecommendations(filterAdult: boolean, ai: RecommendedWork[] = [], now = Date.now(), preferences: HomePreference[] = []): HomeRecommendations {
  const day = homeDay(now), seed = `${day}:${homeCatalogVersion}:${filterAdult}`;
  const allowed = homePreferenceFilter(preferences);
  const scores = new Map<string, ReturnType<typeof homePreferenceScore>>();
  const preferenceFor = (work: RecommendedWork) => {
    if (!scores.has(work.id)) scores.set(work.id, homePreferenceScore(work, preferences));
    return scores.get(work.id)!;
  };
  const personalize = (work: RecommendedWork) => {
    const { reason } = preferenceFor(work);
    return reason ? { ...work, reasons: [reason, ...work.reasons].slice(0, 2) } : work;
  };
  const unique = new Map<string, RecommendedWork>();
  for (const work of recommendationCatalog) if (eligibleHomeWork(work, filterAdult) && allowed(work) && !unique.has(work.id)) {
    unique.set(work.id, { ...work, reasons: [work.genres.length ? `精选片单 · ${work.genres.slice(0, 2).join(' / ')}` : '来自精选片单'] });
  }
  const local = [...unique.values()].sort((a, b) => preferenceFor(b).score - preferenceFor(a).score
    || hash(seed + a.id) - hash(seed + b.id) || a.id.localeCompare(b.id));
  const verified = verifiedHomeAI(ai, filterAdult).filter(allowed);
  const used = new Set<string>();
  const batches: RecommendedWork[][] = [];
  for (let batch = 0; batch < 3; batch++) {
    const chosen: RecommendedWork[] = [], actors = new Map<string, number>(), series = new Map<string, number>();
    const directors = new Map<string, number>();
    const genres = new Map<string, number>(), decades = new Map<string, number>();
    const add = (work: RecommendedWork, diverse: boolean) => {
      const franchise = seriesQuery(work.title), decade = work.year.slice(0, 3);
      if (used.has(work.id) || chosen.length >= 12 || work.cast.some(p => (actors.get(p) || 0) >= 3)
        || work.directors.some(p => (directors.get(p) || 0) >= 2)
        || (franchise && (series.get(franchise) || 0) >= 2)) return;
      if (diverse && ((decades.get(decade) || 0) >= 4 || (work.genres[0] && (genres.get(work.genres[0]) || 0) >= 4))) return;
      used.add(work.id); chosen.push(personalize(work));
      work.cast.forEach(p => actors.set(p, (actors.get(p) || 0) + 1));
      work.directors.forEach(p => directors.set(p, (directors.get(p) || 0) + 1));
      if (franchise) series.set(franchise, (series.get(franchise) || 0) + 1);
      decades.set(decade, (decades.get(decade) || 0) + 1);
      if (work.genres[0]) genres.set(work.genres[0], (genres.get(work.genres[0]) || 0) + 1);
    };
    // Leave room for exploration and retain director/cast/genre diversity in every batch.
    for (const work of local) { if (chosen.length >= 8 || preferenceFor(work).score <= 0) break; add(work, true); }
    if (preferences.some(item => item.vote === 'like')) {
      local.filter(work => preferenceFor(work).score === 0).forEach(work => add(work, true));
    }
    let aiCount = 0;
    for (const work of verified) {
      if (aiCount >= 4) break;
      if (preferenceFor(work).score < 0) continue;
      const before = chosen.length; add(work, true); if (chosen.length > before) aiCount++;
    }
    local.filter(w => preferenceFor(w).score >= 0).forEach(w => add(w, true));
    local.filter(w => preferenceFor(w).score >= 0).forEach(w => add(w, false));
    local.forEach(w => add(w, true));
    local.forEach(w => add(w, false));
    if (chosen.length) batches.push(chosen);
  }
  // Monday in Shanghai starts a new set of weekly collections.
  const dayNumber = Math.floor(Date.parse(`${day}T00:00:00Z`) / 86400000);
  const week = Math.floor((dayNumber + 3) / 7);
  const topics = collections.map(c => ({ c, works: c.sections.flatMap(s => s.films)
    .map(([t, y]) => recommendationByTitle(t, y))
    .filter((w): w is RecommendedWork => Boolean(w && eligibleHomeWork(w, filterAdult) && allowed(w))) }))
    .filter(c => c.works.length).sort((a, b) => hash(`${week}:${a.c.id}`) - hash(`${week}:${b.c.id}`)).slice(0, 3);
  return { day, version: homeCatalogVersion, generatedAt: new Date(now).toISOString(),
    expiresAt: new Date(Date.parse(`${day}T00:00:00+08:00`) + 86400000).toISOString(), batches,
    collections: topics.map(({ c, works }) => ({ id: c.id, name: c.name, intro: c.intro,
      count: c.sections.reduce((n, s) => n + s.films.length, 0), poster: works[0].poster })), aiStatus: 'disabled' };
}

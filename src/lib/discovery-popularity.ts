import { createHmac, randomUUID } from 'node:crypto';
import { discoveryTransaction } from './discovery-storage';
import { DAY } from './discovery-catalog';
import type { RecommendedWork } from './recommendations';

export interface WatchSession { id: string; actor: string; workId: string; openedAt: number; lastAt: number; seq: number; played: number; qualified: boolean; duration?: number }
export interface WatchState { version: 1; sessions: WatchSession[]; votes: { actor: string; workId: string; at: number }[]; rates: Record<string, { since: number; starts: number; creditedAt: number }> }
export const emptyWatchState = (): WatchState => ({ version: 1, sessions: [], votes: [], rates: {} });
export function watchActor(account: string | null) {
  const secret = process.env.PROXY_SECRET || process.env.PASSWORD;
  if (!secret) throw new Error('统计暂不可用');
  return createHmac('sha256', secret).update(`discovery-watch:${account || 'shared-password-account'}`).digest('hex');
}
export function pruneWatchState(state: WatchState, now: number) {
  state.votes = state.votes.filter(v => now - v.at < 14 * DAY);
  state.sessions = state.sessions.filter(s => now - s.lastAt < 10 * 60_000 && now - s.openedAt < 6 * 3600_000).slice(-4000);
  for (const [actor, rate] of Object.entries(state.rates)) if (now - rate.since > DAY) delete state.rates[actor];
}
export function startWatch(state: WatchState, actor: string, workId: string, now: number) {
  pruneWatchState(state, now);
  const old = state.rates[actor];
  const rate = old && now - old.since < 3600_000 ? old : { since: now, starts: 0, creditedAt: now };
  if (++rate.starts > 60 || (!old && Object.keys(state.rates).length >= 10000)) throw new Error('请求过于频繁');
  state.rates[actor] = rate;
  // Only a bounded number of simultaneous tabs per signed-in account.
  const own = state.sessions.filter(s => s.actor === actor);
  if (own.length >= 4) state.sessions = state.sessions.filter(s => s.id !== own[0].id);
  const session: WatchSession = { id: randomUUID(), actor, workId, openedAt: now, lastAt: now, seq: 0, played: 0, qualified: false };
  state.sessions.push(session);
  return session.id;
}
export function creditWatch(state: WatchState, actor: string, id: string, seq: number, seconds: number, duration: number, now: number) {
  pruneWatchState(state, now);
  const session = state.sessions.find(s => s.id === id && s.actor === actor);
  if (!session) throw new Error('观看会话已过期');
  if (seq <= session.seq) return { qualified: session.qualified }; // retries are idempotent
  if (seq !== session.seq + 1) throw new Error('观看事件顺序不正确');
  const rate = state.rates[actor];
  if (!rate) throw new Error('观看会话已过期');
  // Client counters can never manufacture wall-clock time or multiply it across tabs.
  const credited = Math.min(seconds, 35, Math.max(0, (now - session.lastAt) / 1000), Math.max(0, (now - rate.creditedAt) / 1000));
  session.played += credited; session.lastAt = now; session.seq = seq; rate.creditedAt = now;
  if (duration > 0) session.duration = Math.max(duration, session.duration || 0);
  const threshold = session.duration && session.duration < 300 ? Math.max(30, session.duration * .8) : 300;
  if (!session.qualified && session.played >= threshold) {
    session.qualified = true;
    // Each account contributes at most one vote per work inside the rolling seven-day window.
    if (!state.votes.some(v => v.actor === actor && v.workId === session.workId && now - v.at < 7 * DAY)) {
      state.votes.push({ actor, workId: session.workId, at: now });
    }
  }
  return { qualified: session.qualified };
}
export function rankPopular(state: WatchState, works: RecommendedWork[], now: number): RecommendedWork[] {
  const counts = new Map<string, Set<string>>(), newest = new Map<string, number>();
  for (const vote of state.votes) if (now - vote.at < 7 * DAY) {
    const ids = counts.get(vote.workId) || new Set(); ids.add(vote.actor); counts.set(vote.workId, ids);
    newest.set(vote.workId, Math.max(newest.get(vote.workId) || 0, vote.at));
  }
  return works.filter(w => (counts.get(w.id)?.size || 0) >= 3)
    .sort((a, b) => counts.get(b.id)!.size - counts.get(a.id)!.size || newest.get(b.id)! - newest.get(a.id)!)
    .slice(0, 10).map(w => ({ ...w, reasons: ['近 7 天 · 多位观众有效观看'] }));
}
export function watchTransaction<R>(fn: (s: WatchState) => R, write = false) {
  return discoveryTransaction('watch', emptyWatchState, fn, write);
}

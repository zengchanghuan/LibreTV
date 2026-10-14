/** Local playback measurements. Probe latency is an estimate, never a promise of smooth decoding. */
export interface PlaybackQuality {
  at: number; startupMs?: number; starts: number; playedMs: number; stalledMs: number; stalls: number;
  failureAt?: number; probe?: { at: number; ok: boolean; ms: number; kbps?: number };
}
export interface PlaybackDelta { startupMs?: number; playedMs: number; stalledMs: number; stalls: number; failed?: boolean }
export const QUALITY_TTL = 7 * 86400_000;
export function updateQuality(old: PlaybackQuality | undefined, delta: PlaybackDelta, now = Date.now()): PlaybackQuality {
  const p = old && now - old.at < QUALITY_TTL ? old : undefined;
  const startup = delta.startupMs;
  return { ...p, at: now, starts: (p?.starts || 0) + (startup === undefined ? 0 : 1),
    startupMs: startup === undefined ? p?.startupMs : p?.startupMs === undefined ? startup : p.startupMs * .65 + startup * .35,
    playedMs: (p?.playedMs || 0) * .95 + Math.max(0, delta.playedMs),
    stalledMs: (p?.stalledMs || 0) * .95 + Math.max(0, delta.stalledMs),
    stalls: (p?.stalls || 0) * .95 + delta.stalls,
    failureAt: delta.failed ? now : startup !== undefined ? undefined : p?.failureAt };
}
export function qualityScore(q?: PlaybackQuality, now = Date.now()): number {
  if (!q || now - q.at > QUALITY_TTL) return 8000;
  const probe = q.probe && now - q.probe.at < 5 * 60_000 ? q.probe : undefined;
  const startup = q.startupMs ?? 8000;
  let score = q.starts ? startup : probe?.ok ? probe.ms + 1500 : 8000;
  if (q.starts && probe?.ok) score = startup * .8 + probe.ms * .2;
  const observed = q.playedMs + q.stalledMs;
  if (observed >= 10000) score += 120000 * q.stalledMs / observed;
  if (q.failureAt && now - q.failureAt < 30 * 60_000) score += 30000;
  if (probe && !probe.ok) score += 15000;
  if (probe?.kbps && probe.kbps < 1200) score += 5000;
  return score;
}
export function qualityLabel(q?: PlaybackQuality, now = Date.now()): string {
  if (!q || now - q.at > QUALITY_TTL) return '待测速';
  if (q.failureAt && now - q.failureAt < 30 * 60_000) return '近期播放失败';
  if (q.starts && q.startupMs !== undefined) {
    const ratio = q.stalledMs / Math.max(1, q.playedMs + q.stalledMs);
    return `实播起播 ${(q.startupMs / 1000).toFixed(1)}s${q.playedMs + q.stalledMs >= 10000 ? ratio > .03 ? ' · 有卡顿' : ' · 较流畅' : ''}`;
  }
  if (q.probe && now - q.probe.at < 5 * 60_000) return q.probe.ok ? `媒体测速 ${(q.probe.ms / 1000).toFixed(1)}s${q.probe.kbps && q.probe.kbps < 1200 ? ' · 低速' : ''}` : '媒体测速未通过';
  return '待测速';
}
/** Monotonic clock; user pause, seeking and hidden tabs are excluded from buffering observations. */
export class PlaybackTracker {
  private last: number; private startup = 0; private started = false; private wanted = true;
  private seeking = false; private hidden = false; private buffering = false; private stall = 0;
  private pending: PlaybackDelta = { playedMs: 0, stalledMs: 0, stalls: 0 };
  constructor(now: number) { this.last = now; }
  private advance(now: number) {
    const dt = Math.max(0, now - this.last); this.last = now;
    if (!this.wanted || this.seeking || this.hidden) return;
    if (!this.started) this.startup += dt;
    else if (this.buffering) this.stall += dt;
    else this.pending.playedMs += dt;
  }
  private closeStall() {
    if (this.stall >= 250) { this.pending.stalledMs += this.stall; this.pending.stalls++; }
    this.stall = 0; this.buffering = false;
  }
  play(now: number) { this.advance(now); this.wanted = true; }
  pause(now: number) { this.advance(now); this.closeStall(); this.wanted = false; }
  playing(now: number) {
    this.advance(now); this.closeStall(); this.wanted = true;
    if (!this.started) { this.started = true; if (!this.hidden) this.pending.startupMs = this.startup; }
  }
  waiting(now: number) { this.advance(now); if (this.started && this.wanted && !this.seeking && !this.hidden) this.buffering = true; }
  seek(now: number, value: boolean) { this.advance(now); this.closeStall(); this.seeking = value; }
  visibility(now: number, hidden: boolean) { this.advance(now); this.closeStall(); this.hidden = hidden; }
  drain(now: number, failed = false): PlaybackDelta {
    this.advance(now);
    // Keep ongoing buffering in the next report, without losing it on disposal.
    if (this.stall >= 250) { this.pending.stalledMs += this.stall; this.pending.stalls++; this.stall = 0; }
    const result = { ...this.pending, failed }; this.pending = { playedMs: 0, stalledMs: 0, stalls: 0 }; return result;
  }
}

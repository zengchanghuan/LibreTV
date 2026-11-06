import type { MediaProbe } from './media-probe';
import { isChineseSubtitle, sourceClaims } from './media-capabilities';
import { qualityScore, type PlaybackQuality } from './playback-quality';

export interface SourcePreference { probe?: MediaProbe; history?: PlaybackQuality; remarks?: string }
export function slowMedia(probe?: MediaProbe): boolean {
  return !!probe?.ok && probe.kbps !== undefined && probe.kbps < Math.max(1200, (probe.bandwidth || 0) / 1000 * 1.2);
}
function preference(value: SourcePreference): number[] {
  const { probe: p, history, remarks } = value;
  const claims = sourceClaims(remarks);
  const hd = (p?.height ?? 0) >= 720;
  const subtitles = p?.subtitles === 'verified';
  const historyOnly = history && { ...history, probe: undefined };
  const recentTrouble = historyOnly && qualityScore(historyOnly) >= 15000;
  return [
    p?.ok === false ? 3 : p?.ok ? slowMedia(p) || p.kbps === undefined || recentTrouble ? 1 : 0 : 2,
    hd && subtitles ? 0 : subtitles ? 1 : hd ? 2 : 3,
    subtitles && isChineseSubtitle(p?.subtitleLanguage) ? 0 : 1,
    // A label is a weak tie-breaker, below measured speed and confirmed tracks.
    (p?.ms ?? qualityScore(historyOnly)) + (p?.kbps ? 2_000_000 / Math.max(1, p.kbps) : 2000) + (historyOnly?.starts ? qualityScore(historyOnly) : 0),
    claims.height && claims.subtitles ? 0 : claims.height || claims.subtitles ? 1 : 2,
  ];
}
export function compareSourcePreference(a: SourcePreference, b: SourcePreference): number {
  const aa = preference(a), bb = preference(b);
  for (let i = 0; i < aa.length; i++) if (aa[i] !== bb[i]) return aa[i] - bb[i];
  return 0;
}
export function mediaPreferenceLabel(probe?: MediaProbe, remarks?: string): string {
  const claims = sourceClaims(remarks);
  const resolution = probe?.height ? `${probe.height}p` : claims.height ? `片源标注 ${claims.height}p` : '清晰度未确认';
  const subtitles = probe?.subtitles === 'verified'
    ? isChineseSubtitle(probe.subtitleLanguage) ? '已检测中文字幕' : '已检测字幕'
    : probe?.subtitles === 'declared' ? '字幕轨待验证' : claims.subtitles ? '片源标注中字' : '字幕未确认';
  const speed = !probe ? '待测速' : !probe.ok ? '媒体测速未通过' :
    `抽样 ${probe.kbps === undefined ? '速度未确认' : `${(probe.kbps / 1000).toFixed(1)} Mbps`}${slowMedia(probe) ? ' · 偏慢' : ''}`;
  return `${resolution} · ${subtitles} · ${speed}`;
}

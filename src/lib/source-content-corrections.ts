import type { SearchResultItem, VideoDetail } from './types';

export interface SourceContentIssue {
  status: 'content-mismatch' | 'needs-recheck';
  message: string;
  checkedAt: string;
}

// Verified against source metadata and opening frames. Never infer the replacement
// work from the source's title/year/cast: those fields all describe the wrong film.
const corrections = [{
  endpoint: '360zy.com/api.php/provide/vod',
  vodId: '8737',
  checkedAt: '2026-11-14',
  playbackUrl: 'https://vod2.maowushi.com/jqp/PgtkJlCJ/index.m3u8',
  message: '源站资料与实际视频不符：该条目标注为韩国版《局内人》，已核对的播放内容不符。已隔离，暂不参与智能优选和换源。',
}] as const;

function endpointKey(value?: string) {
  try {
    const url = new URL(value || '');
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port) return;
    return url.hostname.toLowerCase().replace(/^www\./, '') + url.pathname.replace(/\/+$/, '');
  } catch { return; }
}

/** Quarantine persists until reviewed, even if the upstream URL changes. */
export function sourceContentIssue(sourceUrl?: string, vodId?: string, episodes?: readonly string[]): SourceContentIssue | undefined {
  const rule = corrections.find(value => value.endpoint === endpointKey(sourceUrl) && value.vodId === String(vodId));
  if (!rule) return;
  const changed = episodes !== undefined && (episodes.length !== 1 || episodes[0] !== rule.playbackUrl);
  return { status: changed ? 'needs-recheck' : 'content-mismatch', checkedAt: rule.checkedAt,
    message: changed ? '此资源曾存在资料与视频不符的问题，播放地址已变化，待重新核实。暂不参与智能优选和换源。' : rule.message };
}

/** Also applied to client-side cached search results before grouping. */
export function correctSearchItem(item: SearchResultItem): SearchResultItem {
  const issue = sourceContentIssue(item.sourceUrl, item.vodId);
  return issue ? { ...item, workId: undefined, identityUnconfirmed: true, identityReason: issue.message, pic: undefined } : item;
}

export function canRecommendSource(item: SearchResultItem, resolvedSourceUrl = item.sourceUrl) {
  return !sourceContentIssue(resolvedSourceUrl, item.vodId);
}

/** Keep the original playable URL, but do not present the false movie metadata. */
export function correctVideoDetail(detail: VideoDetail, sourceUrl: string | undefined, vodId: string): VideoDetail {
  const issue = sourceContentIssue(sourceUrl, vodId, detail.episodes);
  if (!issue) return detail;
  const info = detail.videoInfo;
  return { ...detail, videoInfo: { title: info.title, sourceKey: info.sourceKey,
    sourceName: info.sourceName, sourceUrl: sourceUrl || info.sourceUrl, contentIssue: issue } };
}

'use client';

import type { SearchResultItem } from '@/lib/types';
import type { useRankedSources } from './use-ranked-sources';

export function SourceRecommendation({ quality, recommended, onSelect, switching = false }: {
  quality: ReturnType<typeof useRankedSources>;
  recommended?: SearchResultItem;
  onSelect: () => void;
  switching?: boolean;
}) {
  const { progress, testing } = quality;
  return (
    <section className="mb-3 rounded-xl border border-accent/30 bg-accent/5 p-3" aria-label="智能优选">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-accent">智能优选</span>
        <button className="btn-ghost btn-sm shrink-0" disabled={testing} onClick={quality.retest}>重新检测</button>
      </div>
      <div className="mt-1" aria-live="polite" aria-atomic="true">
        <p className="text-sm font-semibold text-content break-words">
          {recommended ? `当前推荐 · ${recommended.sourceName}` : testing ? '正在挑选推荐源…' : switching ? '暂无通过检测的其他片源' : '暂未找到通过检测的片源'}
        </p>
        <p className="mt-1 text-xs leading-5 text-muted">
          {recommended ? quality.labelOf(recommended) : testing ? '视频检测通过后即可选择，字幕信息随后补充。' : '可以重新检测，或从下方列表手动选择。'}
        </p>
      </div>
      {recommended && (
        <button className="btn-primary mt-3 min-h-10 w-full" onClick={onSelect}>
          {switching ? '切换推荐源' : '使用推荐源'}
        </button>
      )}
      <div className="mt-3 border-t border-accent/15 pt-2">
        <p className="text-xs text-muted" role="status">
          已检测 {progress.done}/{progress.total} · {progress.ok} 条媒体检测通过
          {progress.subtitles > 0 && ` · ${progress.subtitles} 条补充字幕中`}
        </p>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-chip" role="progressbar" aria-label="片源检测进度"
          aria-valuemin={0} aria-valuemax={Math.max(1, progress.total)} aria-valuenow={progress.done}>
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progress.total ? progress.done / progress.total * 100 : 0}%` }} />
        </div>
        <p className="mt-2 text-xs text-faint">
          {testing ? recommended ? '可以先使用当前推荐，其余检测继续进行。' : '正在检测视频与速度，请稍候。' : '检测完成，推荐综合参考本次抽样与本机播放记录。'}
        </p>
      </div>
      <details className="mt-2 text-xs text-faint">
        <summary className="cursor-pointer">检测说明</summary>
        <p className="mt-1 leading-5">字幕未确认不代表没有字幕；画面内嵌字幕可能无法识别。速度为当前网络抽样，不保证整片流畅，也不代表已核验影片身份。</p>
      </details>
    </section>
  );
}

import type { SourceContentIssue } from '@/lib/source-content-corrections';

export function SourceContentWarning({ issue }: { issue?: SourceContentIssue }) {
  if (!issue) return null;
  return <aside role="note" aria-label="资源内容纠错" className="mb-4 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm leading-relaxed">
    <p className="font-semibold text-warning">{issue.status === 'needs-recheck' ? '播放地址已变化 · 待重新核实' : '内容不符 · 已隔离'}</p>
    <p className="mt-1 text-content">{issue.message}</p>
    <p className="mt-1 text-xs text-muted">未经确认的海报、年份和影片资料已隐藏。仍可手动播放此资源，或选择其他来源。</p>
  </aside>;
}

'use client';

import { useEffect, useState } from 'react';
import type { VideoInfo } from '@/lib/types';

function available(value: string | undefined): string {
  const text = value?.trim() || '';
  return /^(?:未知|不详|暂无|无|null|undefined|unknown|n\/a|[-—]+)$/i.test(text) ? '' : text;
}

export function VideoInfoPanel({ info }: { info?: VideoInfo }) {
  const [description, setDescription] = useState('');
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    // Parse into an inert template, then render only text. Upstream HTML never
    // enters the live page, and embedded scripts/images are not executed/loaded.
    const template = document.createElement('template');
    template.innerHTML = info?.desc || '';
    template.content.querySelectorAll('script, style, noscript, iframe').forEach((element) => element.remove());
    template.content.querySelectorAll('br').forEach((element) => element.replaceWith('\n'));
    template.content.querySelectorAll('p, div, li').forEach((element) => element.append('\n'));
    setDescription(available(template.content.textContent?.replace(/[^\S\n]+/g, ' ').replace(/\n\s*\n/g, '\n\n')));
    setExpanded(false);
  }, [info?.desc]);

  const rows = [
    ['年份', info?.year],
    ['地区', info?.area],
    ['类型', info?.typeName],
    ['状态', info?.remarks],
    ['导演', info?.director],
    ['主演', info?.actor],
  ].map(([label, value]) => [label, available(value)]).filter(([, value]) => value);

  if (!rows.length && !description) return null;

  return (
    <section className="mt-4 border-t border-line pt-3" aria-labelledby="video-info-heading">
      <h2 id="video-info-heading" className="text-sm font-semibold text-content mb-3">影片信息</h2>
      {rows.length > 0 && (
        <dl className="space-y-2 text-xs leading-relaxed">
          {rows.map(([label, value]) => (
            <div key={label} className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-2">
              <dt className="text-faint">{label}</dt>
              <dd className="min-w-0 text-muted [overflow-wrap:anywhere]">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {description && (
        <div className="mt-3 text-xs leading-relaxed">
          <h3 className="text-faint mb-1.5">剧情简介</h3>
          <p id="video-description" className={`text-muted whitespace-pre-line [overflow-wrap:anywhere] ${expanded ? '' : 'line-clamp-5'}`}>
            {description}
          </p>
          {description.length > 80 && (
            <button
              type="button"
              className="mt-2 text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded"
              aria-expanded={expanded}
              aria-controls="video-description"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? '收起简介' : '展开简介'}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

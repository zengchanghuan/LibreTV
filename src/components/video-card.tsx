'use client';
import { useRankedSources } from './use-ranked-sources';
import { SourceRecommendation } from './source-recommendation';

import { useEffect, useMemo, useState } from 'react';
import type { SearchResultItem } from '@/lib/types';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { SmartImage } from './smart-image';
import { classifyMediaType, type MediaType } from '@/lib/media-type';
import type { AggregatedGroup } from '@/lib/search-result-groups';
import { MediaTypeLabel } from './media-type-label';
import { getFilmPosterMetadataByDoubanId } from '@/lib/film-poster-metadata';

export { aggregateResults } from '@/lib/search-result-groups';
export type { AggregatedGroup } from '@/lib/search-result-groups';

/**
 * 聚合影片卡片：
 * - 单源：点击直接打开该源详情（与旧体验一致）；
 * - 多源：显示「N 个来源」徽章，点击展开各源列表，选择具体源后打开详情。
 */
export function AggregatedCard({
  group,
  onOpen,
}: {
  group: AggregatedGroup;
  onOpen: (item: SearchResultItem) => void;
}) {
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);
  const [imgFailed, setImgFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const showImg = !!group.pic && !imgFailed;
  const quality = useRankedSources(group.items, expanded);

  const multi = group.items.length > 1;
  const sourceCount = new Set(group.items.map(item => item.sourceKey)).size;
  const adult = useMemo(() => group.items.some((i) => i.isAdult), [group.items]);

  const activate = () => {
    if (multi) setExpanded((v) => !v);
    else onOpen(group.items[0]);
  };

  return (
    <div className={cn('card', !multi && 'hover:scale-[1.02] hover:shadow-md', multi && expanded && 'ring-1 ring-accent/40')}>
      {/* 不用 h-full：展开面板需要撑高卡片，等高裁切会让面板不可见 */}
      <div
        className="flex h-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
        role="button"
        tabIndex={0}
        aria-expanded={multi ? expanded : undefined}
        onClick={activate}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            activate();
          }
        }}
      >
        {showImg ? (
          <div className="relative flex-shrink-0 w-[105px] sm:w-[120px] aspect-[2/3] bg-chip">
            <SmartImage
              url={group.pic}
              mode={imageProxyMode}
              customProxy={customImageProxy}
              alt={group.name}
              className="absolute inset-0 h-full w-full object-cover"
              onExhausted={() => setImgFailed(true)}
            />
            <div className="absolute inset-0 bg-gradient-to-r from-black/30 to-transparent" />
            {multi && (
              <span className="absolute top-1.5 left-1.5 tag bg-black/70 text-accent font-medium">
                {sourceCount} 源
              </span>
            )}
          </div>
        ) : (
          <div className="relative flex-shrink-0 w-[105px] sm:w-[120px] aspect-[2/3] bg-chip flex items-center justify-center">
            <svg className="w-8 h-8 text-faint" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 4v16m10-16v16M3 6a1 1 0 011-1h1a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6zm4 0a1 1 0 011-1h1a1 1 0 011 1v12a1 1 0 01-1 1h-1a1 1 0 01-1-1V6zm8 0a1 1 0 011-1h1a1 1 0 011 1v12a1 1 0 01-1 1h-1a1 1 0 01-1-1V6zm4 0a1 1 0 011-1h1a1 1 0 011 1v12a1 1 0 01-1 1h-1a1 1 0 01-1-1V6z" />
            </svg>
            {multi && (
              <span className="absolute top-1.5 left-1.5 tag bg-black/70 text-accent font-medium">
                {sourceCount} 源
              </span>
            )}
          </div>
        )}

        <div className="p-2.5 flex flex-col flex-grow min-w-0">
          <div className="flex-grow">
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <h3 className="min-w-0 font-semibold text-sm text-content line-clamp-2" title={group.name}>
                {group.name}
              </h3>
              <MediaTypeLabel type={group.mediaType} />
            </div>
            <div className="flex flex-wrap gap-1 mb-1.5">
              {group.typeName && <span className="tag bg-accent/15 text-accent">{group.typeName}</span>}
              {group.year && <span className="tag bg-purple-500/15 text-purple-600 dark:text-purple-300">{group.year}</span>}
              {adult && <span className="tag bg-pink-500/15 text-pink-600 dark:text-pink-400">(18+)</span>}
              {group.identityUnconfirmed && <span className="tag bg-chip text-warning">归属待确认</span>}
            </div>
            {group.identityReason && <p className="text-xs text-warning mb-2">{group.identityReason}</p>}
            {(!multi && (group.identityUnconfirmed || group.items[0].identityDetails)) && (
              <p className="text-xs text-faint mb-2 break-words">片源原始资料：{group.items[0].name} · {group.items[0].year || '年份未知'} · {group.items[0].typeName || '未分类'}</p>
            )}
            <p className="text-xs text-muted line-clamp-2 mb-2">{group.remarks || '暂无介绍'}</p>
          </div>
          <div className="flex items-center justify-between mt-auto pt-1.5 border-t border-line">
            <span className="tag bg-chip text-muted truncate max-w-[80%]">
              {multi ? `${sourceCount} 个来源 · ${group.items.length} 条片源` : group.items[0].sourceName}
            </span>
            {multi && (
              <svg
                className={cn('w-4 h-4 text-faint transition-transform', expanded && 'rotate-180')}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            )}
          </div>
        </div>
      </div>

      {multi && expanded && (
        <div className="border-t border-line p-2.5 animate-fade-in">
          <SourceRecommendation quality={quality} recommended={quality.best}
            onSelect={() => quality.best && onOpen(quality.best)} />
          <div className="flex flex-col gap-1.5">
            {quality.ranked.map((item) => (
              <button
                key={`${item.sourceKey}_${item.vodId}`}
                className={cn(
                  'group flex items-center justify-between gap-1.5 w-full rounded-lg border px-2.5 py-2 text-left',
                  'text-xs transition-all cursor-pointer',
                  'hover:border-accent hover:bg-accent/10',
                  quality.best === item ? 'border-accent/40 bg-accent/5' : 'border-line bg-chip',
                  item.isAdult && 'border-pink-500/30'
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen(item);
                }}
                aria-label={`使用 ${item.sourceName} 播放`}
              >
                <span className="min-w-0">
                  <span className="block font-medium text-content break-words">{item.sourceName}{quality.best === item ? ' · 推荐' : ''}</span>
                  <span className="block text-faint">片源原始资料：{item.name} · {item.year || '年份未知'} · {item.typeName || '未分类'}</span>
                  <span className="mt-1 block text-muted">{quality.statusOf(item)}</span>
                  <span className="mt-1 block text-faint leading-5">{quality.labelOf(item)}</span>
                </span>
                <svg
                  className="w-3.5 h-3.5 text-accent shrink-0 transition-transform group-hover:scale-110"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden
                >
                  <path d="M8 5v14l11-7z" />
                </svg>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** 影片卡片：封面加载失败时逐级降级到占位图（未聚合的单一结果使用） */
export function VideoCard({ item, onClick }: { item: SearchResultItem; onClick: () => void }) {
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);
  const [imgFailed, setImgFailed] = useState(false);
  const showImg = !!item.pic && !imgFailed;

  return (
    <div
      className="card cursor-pointer hover:scale-[1.02] hover:shadow-md h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          // 阻止空格触发页面滚动（AggregatedCard 已是此写法，此处对齐）
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="flex h-full">
        {showImg ? (
          <div className="relative flex-shrink-0 w-[105px] sm:w-[120px] aspect-[2/3] bg-chip">
            <SmartImage
              url={item.pic}
              mode={imageProxyMode}
              customProxy={customImageProxy}
              alt={item.name}
              className="h-full w-full object-cover"
              onExhausted={() => setImgFailed(true)}
            />
            <div className="absolute inset-0 bg-gradient-to-r from-black/30 to-transparent" />
          </div>
        ) : (
          <div className="flex-shrink-0 w-[105px] sm:w-[120px] aspect-[2/3] bg-chip flex items-center justify-center">
            <svg className="w-8 h-8 text-faint" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 4v16m10-16v16M3 6a1 1 0 011-1h1a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6zm4 0a1 1 0 011-1h1a1 1 0 011 1v12a1 1 0 01-1 1h-1a1 1 0 01-1-1V6zm8 0a1 1 0 011-1h1a1 1 0 011 1v12a1 1 0 01-1 1h-1a1 1 0 01-1-1V6zm4 0a1 1 0 011-1h1a1 1 0 011 1v12a1 1 0 01-1 1h-1a1 1 0 01-1-1V6z" />
            </svg>
          </div>
        )}

        <div className="p-2.5 flex flex-col flex-grow min-w-0">
          <div className="flex-grow">
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <h3 className="min-w-0 font-semibold text-sm text-content line-clamp-2" title={item.name}>
                {item.name}
              </h3>
              <MediaTypeLabel type={classifyMediaType(item.typeName)} />
            </div>
            <div className="flex flex-wrap gap-1 mb-1.5">
              {item.typeName && <span className="tag bg-accent/15 text-accent">{item.typeName}</span>}
              {item.year && <span className="tag bg-purple-500/15 text-purple-600 dark:text-purple-300">{item.year}</span>}
            </div>
            <p className="text-xs text-muted line-clamp-2 mb-2">{item.remarks || '暂无介绍'}</p>
          </div>
          <div className="flex items-center justify-between mt-auto pt-1.5 border-t border-line">
            <span className="tag bg-chip text-muted truncate max-w-[80%]">{item.sourceName}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 豆瓣推荐卡片（无来源徽章，点击直接搜索） */
export function DoubanCard({ item, mediaType, doubanId, onClick }: {
  item: { title: string; cover: string; rating?: string; isTv?: boolean };
  mediaType?: MediaType;
  doubanId?: string;
  onClick: () => void;
}) {
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => setImgFailed(false), [item.cover]);
  const film = doubanId ? getFilmPosterMetadataByDoubanId(doubanId) : undefined;
  const rating = item.rating ?? film?.metadata.rating;

  return (
    <div
      className="card cursor-pointer hover:scale-[1.03] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          // 阻止空格触发页面滚动（AggregatedCard 已是此写法，此处对齐）
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="relative aspect-[2/3] bg-chip">
        {item.cover && !imgFailed ? (
          <SmartImage
            url={item.cover}
            mode={imageProxyMode}
            customProxy={customImageProxy}
            alt={item.title}
            className="w-full h-full object-cover"
            onExhausted={() => setImgFailed(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-chip">
            <svg className="w-8 h-8 text-faint" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 4v16m10-16v16M3 6a1 1 0 011-1h1a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6zm4 0a1 1 0 011-1h1a1 1 0 011 1v12a1 1 0 01-1 1h-1a1 1 0 01-1-1V6zm8 0a1 1 0 011-1h1a1 1 0 011 1v12a1 1 0 01-1 1h-1a1 1 0 01-1-1V6zm4 0a1 1 0 011-1h1a1 1 0 011 1v12a1 1 0 01-1 1h-1a1 1 0 01-1-1V6z" />
            </svg>
          </div>
        )}
        <MediaTypeLabel type={mediaType ?? (item.isTv === true ? 'tv' : item.isTv === false ? 'movie' : 'unknown')} overlay />
      </div>
      <div className="flex items-center justify-between gap-1.5 p-2">
        <div className="min-w-0 truncate text-xs font-medium text-content" title={item.title}>
          {item.title}
        </div>
        {rating && (
          <span className="shrink-0 whitespace-nowrap text-xs font-medium text-rating">
            <span aria-hidden="true">★ </span>
            <span className="sr-only">豆瓣评分 </span>
            {rating}
          </span>
        )}
      </div>
      {film && (
        <div className="space-y-1 px-2 pb-2 text-xs text-muted">
          <p>{film.year}{film.metadata.genre && ` · ${film.metadata.genre}`}</p>
          {film.metadata.cast && <p>主演：{film.metadata.cast}</p>}
          {film.metadata.director && <p>导演：{film.metadata.director}</p>}
        </div>
      )}
    </div>
  );
}

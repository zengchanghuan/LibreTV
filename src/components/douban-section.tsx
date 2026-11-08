'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { HomeDiscovery } from './home-discovery';
import type { SourceConfig } from '@/lib/types';
import type { DoubanItem } from '@/lib/types';
import { filmCollections, koreanModernHistory, type FilmCollection } from '@/lib/film-collections';
import { chungmuroCollection } from '@/lib/chungmuro-collection';
import { peopleCollections } from '@/lib/people-collections';
import { FilmPosterGrid } from './film-poster-grid';
import { KoreanThrillers } from './korean-thrillers';
import { Spinner } from './states';
import { DoubanCard } from './video-card';

const MOVIE_TAGS = ['热门', '最新', '经典', '豆瓣高分', '冷门佳片', '华语', '欧美', '韩国', '日本', '动画'];
const TV_TAGS = ['热门', '美剧', '英剧', '韩剧', '日剧', '国产剧', '港剧', '日本动画', '综艺', '纪录片'];
const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

const topicOptions = [
  { id: 'home', name: '首页推荐' },
  { id: 'korean', name: '韩国政治惊悚片' },
  { id: chungmuroCollection.id, name: chungmuroCollection.name },
  { id: koreanModernHistory.id, name: koreanModernHistory.name },
  { id: 'zhangyan', name: '张燕版韩国政治惊悚片' },
  ...filmCollections.map(({ id, name }) => ({ id, name })),
];
const allCollections: FilmCollection[] = [chungmuroCollection, koreanModernHistory, ...filmCollections, ...peopleCollections];
const directories = {
  topics: topicOptions,
  directors: peopleCollections.filter(({ role }) => role !== 'actor').flatMap<FilmCollection>(person =>
    person.id === 'person-宫崎骏'
      ? [...filmCollections.filter(({ id }) => id === 'kurosawa'), person]
      : [person]),
  actors: peopleCollections.filter(({ role }) => role !== 'director'),
};
const directoryLabels = [
  ['topics', '主题片单'], ['directors', '按导演'], ['actors', '按演员'],
] as const;

export function RecommendSection({ visible, onPick, sources = [], section }: { visible: boolean; onPick: (title: string) => void; sources?: SourceConfig[]; section?: 'hd' }) {
  const doubanEnabled = useAppStore((s) => s.doubanEnabled);
  const recommendSource = useAppStore((s) => s.recommendSource);
  const homeLayout = useAppStore(s => s.homeLayout);
  const [discovery, setDiscovery] = useState(true);

  const [collection, setCollection] = useState('home');
  const [directory, setDirectory] = useState<keyof typeof directories>('topics');
  const [filter, setFilter] = useState('');
  if (!visible || !doubanEnabled) return null;
  const selected = allCollections.find(({ id }) => id === collection);
  const options = directories[directory];
  const matches = directory === 'topics' ? options : options.filter(option =>
    (option.name + ('fullName' in option ? option.fullName : '')).includes(filter.trim()));
  const showDiscovery = homeLayout === 'curated' && discovery;
  const charts = recommendSource === 'bangumi' ? <BangumiView onPick={onPick} /> : recommendSource === 'douban' ? <DoubanView onPick={onPick} /> : <HotListView onPick={onPick} />;
  return <>
    <nav aria-label="必看片单" className="mb-5">
      {!showDiscovery && <div className="mb-2 flex items-baseline gap-2">
        <h2 className="text-lg font-bold">必看片单</h2>
        <span className="text-xs text-muted">{topicOptions.length - 1 + peopleCollections.length} 份片单</span>
      </div>}
      <div className="mb-2 flex flex-wrap items-center gap-1">
        {homeLayout === 'curated' && <TypeButton active={showDiscovery} onClick={() => setDiscovery(true)}>为你精选</TypeButton>}
        {directoryLabels.map(([key, label]) => (
          <TypeButton key={key} active={!showDiscovery && directory === key} onClick={() => {
            setDiscovery(false);
            if (directory === key) return;
            setDirectory(key);
            setFilter('');
            setCollection(directories[key][0].id);
          }}>{label}</TypeButton>
        ))}
      </div>
      {!showDiscovery && <>
      <select aria-label="选择片单" value={collection} onChange={(event) => setCollection(event.target.value)}
        className="w-full rounded-lg bg-chip px-3 py-2 text-sm text-content sm:hidden">
        {options.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
      </select>
      {directory !== 'topics' && (
        <input type="search" aria-label="筛选人物" placeholder="输入人名" value={filter}
          onChange={event => setFilter(event.target.value)}
          className="mb-2 hidden w-full rounded-lg bg-chip px-3 py-2 text-sm sm:block" />
      )}
      <div className="hidden max-h-52 flex-wrap gap-1 overflow-y-auto rounded-lg bg-chip p-1 sm:flex">
        {matches.map(({ id, name }) => (
          <TypeButton key={id} active={collection === id} onClick={() => setCollection(id)}>{name}</TypeButton>
        ))}
        {!matches.length && <p className="p-2 text-sm text-muted">没有匹配的人物</p>}
      </div>
      </>}
    </nav>
    {showDiscovery ? <HomeDiscovery sources={sources} section={section} charts={charts} onCollection={id => {
      const person = peopleCollections.find(p => p.id === id);
      setDirectory(person ? person.role === 'actor' ? 'actors' : 'directors' : 'topics');
      setFilter(''); setCollection(id === 'topics' ? 'home' : id); setDiscovery(false);
    }} /> : selected ? <CollectionList collection={selected} onPick={onPick} /> :
      collection === 'korean' || collection === 'zhangyan' ? <KoreanThrillers onPick={onPick} zhangYan={collection === 'zhangyan'} /> :
      recommendSource === 'bangumi' ? <BangumiView onPick={onPick} /> :
      recommendSource === 'hot-list' ? <HotListView onPick={onPick} /> : <DoubanView onPick={onPick} />}
  </>;
}

function CollectionList({ collection, onPick }: { collection: FilmCollection; onPick: (title: string) => void }) {
  const films = collection.sections.flatMap(({ films, mediaType }) =>
    films.map(([title, year]) => ({ id: `${title}|${year}`, title, year, mediaType })));
  return (
    <section aria-label={collection.name}>
      <h2 className="text-xl font-bold">{collection.name}</h2>
      {collection.intro && <p className="mt-1 text-sm text-muted">{collection.intro}</p>}
      <p className="mb-4 mt-1 text-sm text-muted">
        共 {films.length} 部 · 选择影片搜索片源
        {collection.source && (
          <> · <a href={collection.source.url} target="_blank" rel="noopener noreferrer" className="underline">{collection.source.name}</a></>
        )}
      </p>
      <FilmPosterGrid films={films} onPick={onPick} />
    </section>
  );
}

/**
 * 豆瓣推荐：影视切换 + 标签筛选。
 * 一次性渲染全部条目：数据本就一次拉全（50 条），卡片图片又是 lazy 加载，
 * 视口外的图不会请求，因此不需要「加载更多」这类本地切片分页来打断浏览。
 */
function DoubanView({ onPick }: { onPick: (title: string) => void }) {
  const [type, setType] = useState<'movie' | 'tv'>('movie');
  const [tag, setTag] = useState('热门');

  const query = useQuery({
    queryKey: ['douban', type, tag],
    queryFn: ({ signal }) => api.douban(type, tag, 0, 50, signal),
  });

  const tags = type === 'movie' ? MOVIE_TAGS : TV_TAGS;
  const items = query.data?.items ?? [];

  const switchType = (t: 'movie' | 'tv') => {
    if (t === type) return;
    setType(t);
    setTag('热门');
  };

  return (
    <section aria-label="影视推荐">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="flex bg-chip rounded-lg p-0.5">
            <TypeButton active={type === 'movie'} onClick={() => switchType('movie')}>
              电影
            </TypeButton>
            <TypeButton active={type === 'tv'} onClick={() => switchType('tv')}>
              剧集
            </TypeButton>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-4">
        {tags.map((t) => (
          <button
            key={t}
            className={cn(
              'px-2.5 py-1 rounded-full text-xs transition-colors',
              t === tag ? 'bg-accent text-on-accent' : 'bg-chip text-muted hover:text-content hover:bg-hover'
            )}
            onClick={() => setTag(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {query.isError ? (
        <p className="text-center text-sm text-faint py-8">推荐内容加载失败，可稍后重试或在设置中关闭</p>
      ) : query.isLoading ? (
        <GridSkeleton />
      ) : items.length === 0 ? (
        <p className="text-center text-sm text-faint py-8">该分类暂无推荐内容</p>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2.5">
          {items.map((item) => (
            <DoubanCard key={item.id} item={item}
              doubanId={type === 'movie' ? item.id : undefined}
              mediaType={type === 'movie' ? 'movie' : tag === '综艺' ? 'variety' : tag === '日本动画' ? 'animation' : tag === '纪录片' ? 'documentary' : 'tv'}
              onClick={() => onPick(item.title)} />
          ))}
        </div>
      )}
    </section>
  );
}

/** Bangumi 每日放送：星期筛选，一次拉全量无分页 */
function BangumiView({ onPick }: { onPick: (title: string) => void }) {
  const [weekday, setWeekday] = useState<number | 'all'>('all');

  const query = useQuery({
    queryKey: ['bangumi-calendar'],
    queryFn: ({ signal }) => api.bangumiCalendar(signal),
  });

  let items: DoubanItem[] = [];
  if (query.data) {
    items = weekday === 'all'
      ? query.data.days.flatMap((d) => d.items)
      : (query.data.days.find((d) => d.weekday === weekday)?.items ?? []);
  }

  return (
    <section aria-label="新番放送推荐">
      <div className="flex flex-wrap gap-1.5 mb-4">
        <ChipButton active={weekday === 'all'} onClick={() => setWeekday('all')}>
          全部
        </ChipButton>
        {WEEKDAYS.map((name, i) => (
          <ChipButton key={name} active={weekday === i + 1} onClick={() => setWeekday(i + 1)}>
            {name}
          </ChipButton>
        ))}
      </div>

      {query.isError ? (
        <p className="text-center text-sm text-faint py-8">推荐内容加载失败，可稍后重试或在设置中关闭</p>
      ) : query.isLoading ? (
        <GridSkeleton />
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2.5">
          {items.map((item) => (
            <DoubanCard key={item.id} item={item} mediaType="animation" onClick={() => onPick(item.title)} />
          ))}
        </div>
      )}
    </section>
  );
}

const HOT_LISTS = [
  { id: 'douban_movie_weekly', label: '电影周榜' },
  { id: 'douban_tv_chinese', label: '国产剧周榜' },
  { id: 'douban_tv_global', label: '海外剧周榜' },
  { id: 'douban_show_chinese', label: '国内综艺' },
  { id: 'douban_show_global', label: '海外综艺' },
  { id: 'baidu_teleplay', label: '百度热播剧' },
];

/** 影视热榜（60s API）：豆瓣五个周榜 + 百度热播剧，chips 切换 */
function HotListView({ onPick }: { onPick: (title: string) => void }) {
  const [listId, setListId] = useState(HOT_LISTS[0].id);

  const query = useQuery({
    queryKey: ['hot-list', listId],
    queryFn: ({ signal }) => api.hotList(listId, signal),
    staleTime: 60_000,
  });

  const items = query.data?.items ?? [];

  return (
    <section aria-label="影视榜单推荐">
      {query.data?.stale && <p className="mb-3 text-xs text-muted" role="status">榜单暂未更新，显示上次结果{query.data.updatedAt ? `（北京时间 ${new Date(query.data.updatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}）` : ''}。</p>}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {HOT_LISTS.map((l) => (
          <ChipButton key={l.id} active={listId === l.id} onClick={() => setListId(l.id)}>
            {l.label}
          </ChipButton>
        ))}
      </div>

      {query.isError ? (
        <p className="text-center text-sm text-faint py-8">推荐内容加载失败，可稍后重试或在设置中关闭</p>
      ) : query.isLoading ? (
        <GridSkeleton />
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2.5">
          {items.map((item) => (
            <DoubanCard key={item.id} item={item}
              doubanId={listId === 'douban_movie_weekly' ? item.id : undefined}
              mediaType={listId === 'douban_movie_weekly' ? 'movie' : listId.startsWith('douban_show_') ? 'variety' : 'tv'}
              onClick={() => onPick(item.title)} />
          ))}
        </div>
      )}
    </section>
  );
}

function GridSkeleton() {
  return (
    <div role="status" aria-label="正在加载推荐…">
      <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted"><Spinner size="md" />正在加载推荐…</div>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2.5">
        {Array.from({ length: 16 }).map((_, i) => (
          <div key={i}>
            <div className="aspect-[2/3] rounded-lg bg-chip animate-pulse" />
            <div className="h-3 mt-2 rounded bg-chip animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}

function ChipButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className={cn(
        'px-2.5 py-1 rounded-full text-xs transition-colors',
        active ? 'bg-accent text-on-accent' : 'bg-chip text-muted hover:text-content hover:bg-hover'
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function TypeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className={cn('px-3.5 py-1.5 rounded-md text-sm transition-colors', active ? 'bg-accent text-on-accent' : 'text-muted hover:text-content')}
      onClick={onClick}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

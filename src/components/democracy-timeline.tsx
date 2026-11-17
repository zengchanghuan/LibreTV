import { getFilmPosterMetadata } from '@/lib/film-poster-metadata';
import Link from 'next/link';
import { buildWatchUrl } from '@/lib/utils';
import type { SourceConfig } from '@/lib/types';
import { Icon } from './icon';
import { FilmPoster } from './film-poster';
import styles from './democracy-timeline.module.css';

export const democracyTopic = { id: 'korean-democracy', name: '韩国民主化进程' };
const endpoints = {
  liangzi: 'https://cj.lziapi.com/api.php/provide/vod/from/lzm3u8',
  feifan: 'https://cj.ffzyapi.com/api.php/provide/vod/from/ffm3u8',
};
type Playback = { provider: keyof typeof endpoints } & ({ vodId: string } | { episodeUrl: string });
type Film = [title: string, year: number, playback: Playback | 'archive'];
const events: { date: string; event: string; films: Film[] }[] = [
  { date: '1979年10月', event: '朴正熙遇刺', films: [['南山的部长们', 2020, { provider: 'liangzi', vodId: '21581' }]] },
  { date: '1979年12月', event: '双十二军事叛乱', films: [['首尔之春', 2023, { provider: 'liangzi', vodId: '82532' }]] },
  { date: '1980年5月', event: '光州民主化运动', films: [['出租车司机', 2017, { provider: 'liangzi', vodId: '83979' }], ['华丽的假期', 2007, { provider: 'liangzi', vodId: '82645' }], ['花瓣', 1996, { provider: 'liangzi', vodId: '63848' }], ['薄荷糖', 1999, { provider: 'liangzi', vodId: '31459' }]] },
  { date: '1981年', event: '釜林事件', films: [['辩护人', 2013, { provider: 'liangzi', vodId: '665' }]] },
  { date: '1985年', event: '南营洞刑讯事件', films: [['南营洞1985', 2012, { provider: 'feifan', episodeUrl: 'https://vip.ffzy-online1.com/20231104/44143_01ddfd53/index.m3u8' }]] },
  { date: '1987年6月', event: '六月民主抗争', films: [['1987：黎明到来的那一天', 2017, { provider: 'liangzi', vodId: '30946' }]] },
  { date: '1997—1998', event: '首次朝野和平轮替', films: [['金大中就职影像', 1998, 'archive']] },
  { date: '2006年前后', event: '光州事件二十六年后', films: [['26年', 2012, { provider: 'feifan', vodId: '56881' }]] },
  { date: '约2020年', event: '光州事件四十年后', films: [['以儿子的名义', 2021, { provider: 'liangzi', vodId: '21488' }]] },
];
const officialPages: Partial<Record<string, { label: string; href: string; cover: string }>> = {
  '金大中就职影像': {
    label: '查看官方档案',
    cover: '/posters/korean/kim-dae-jung-inauguration.jpg',
    href: 'https://www.ehistory.go.kr/view/movie?mediadtl=9173&mediagbn=DT&mediaid=2303&mediasrcgbn=KV',
  },
};
const entries = events.flatMap(({ films }) => films);
const archiveCount = entries.filter(([, , kind]) => kind === 'archive').length;
const movieCount = entries.length - archiveCount;

export function DemocracyTimeline({ sources }: { sources: SourceConfig[] }) {
  return <section className={styles.sheet} aria-labelledby="democracy-title">
    <header><h2 id="democracy-title">{democracyTopic.name}</h2><p>{events.length} 个历史节点 · {movieCount} 部电影 · {archiveCount} 段档案影像</p></header>
    <ol>{events.map(({ date, event, films }) => <li key={date} className={styles.row}>
      <div className={styles.heading}>
        <span className={styles.date}>{date}</span>
        <h3>{event}</h3>
      </div>
      <div className={styles.cards}>{films.map(([title, year, playback]: Film) => {
        const official = officialPages[title];
        const poster = official?.cover ?? getFilmPosterMetadata(title, year)?.poster;
        const content = <>
          <div className={styles.art}>{poster
            ? <FilmPoster mode="direct" url={poster} title={title} imageAlt={official ? `${title}档案画面` : undefined} />
            : <Icon name={official ? 'link' : 'play'} className="h-5 w-5" />}</div>
          <div className={styles.caption}><strong>{title}</strong><small>{year} · {playback === 'archive' ? '档案影像' : '电影'}{official && ` · ${official.label}`}</small></div>
        </>;
        if (official) return <a key={title} className={styles.card} href={official.href} target="_blank" rel="noreferrer" aria-label={`前往${official.label}：《${title}》`}>{content}</a>;
        if (playback === 'archive') return null;
        const sourceUrl = endpoints[playback.provider];
        const sourceKey = sources.find(source => source.url === sourceUrl)?.key ?? playback.provider;
        const href = buildWatchUrl({ sourceKey, sourceUrl, title, ...('vodId' in playback
          ? { vodId: playback.vodId }
          : { episodeUrl: `/api/proxy?url=${encodeURIComponent(playback.episodeUrl)}` }) });
        return <Link key={title} href={href} prefetch={false} className={styles.card} aria-label={`播放《${title}》（${year}）`}>{content}</Link>;
      })}</div>
    </li>)}</ol>
  </section>;
}

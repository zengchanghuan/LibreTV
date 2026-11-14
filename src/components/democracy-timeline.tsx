import { getFilmPosterMetadata } from '@/lib/film-poster-metadata';
import { contextForFilm, type PickFilm } from '@/lib/work-search';
import { FilmPoster } from './film-poster';
import styles from './democracy-timeline.module.css';

export const democracyTopic = { id: 'korean-democracy', name: '韩国民主化进程' };
type Film = [title: string, year: number, kind?: 'movie' | 'tv' | 'documentary' | 'archive'];
const events: { date: string; event: string; films: Film[] }[] = [
  { date: '1960—1961', event: '四一九革命与五一六政变', films: [['第二共和国', 1989, 'tv']] },
  { date: '1970年代起', event: '反对派人物纪事', films: [['路上的金大中', 2024, 'documentary']] },
  { date: '1979年10月', event: '朴正熙遇刺', films: [['南山的部长们', 2020]] },
  { date: '1979年12月', event: '双十二军事叛乱', films: [['首尔之春', 2023]] },
  { date: '1980年5月', event: '光州民主化运动', films: [['出租车司机', 2017], ['华丽的假期', 2007], ['花瓣', 1996]] },
  { date: '1981年', event: '釜林事件', films: [['辩护人', 2013]] },
  { date: '1987年6月', event: '六月民主抗争', films: [['1987：黎明到来的那一天', 2017]] },
  { date: '1997—1998', event: '首次朝野和平轮替', films: [['金大中就职影像', 1998, 'archive']] },
  { date: '2006年前后', event: '光州事件二十六年后', films: [['26年', 2012]] },
  { date: '约2020年', event: '光州事件四十年后', films: [['以儿子的名义', 2021]] },
];
const officialPages: Partial<Record<string, { label: string; href: string }>> = {
  '金大中就职影像': { label: '查看官方档案', href: 'https://www.ehistory.go.kr/view/movie?mediadtl=9173&mediagbn=DT&mediaid=2303&mediasrcgbn=KV' },
};
const kinds = { movie: '电影', tv: '电视剧', documentary: '纪录片', archive: '档案影像' };

export function DemocracyTimeline({ onPick }: { onPick: PickFilm }) {
  return <section className={styles.sheet} aria-labelledby="democracy-title">
    <header><h2 id="democracy-title">{democracyTopic.name}</h2><p>影视时间线</p></header>
    <ol>{events.map(({ date, event, films }) => <li key={date} className={styles.row}>
      <span className={styles.date}>{date}</span>
      <div className={styles.event}>
        <h3>{event}</h3>
        <div className={styles.cards}>{films.map(([title, year, kind = 'movie']: Film) => {
          const poster = getFilmPosterMetadata(title, year)?.poster;
          const official = officialPages[title];
          const unavailable = title === '第二共和国' || title === '路上的金大中';
          const content = <>
            <div className={styles.art}>{poster
              ? <FilmPoster mode="direct" url={poster} title={title} />
              : <span aria-hidden="true">{title}</span>}</div>
            <div className={styles.caption}><strong>《{title}》</strong><small>{year} · {kinds[kind]}{unavailable && ' · 暂无已验证正片'}{official && ` · ${official.label} ↗`}</small></div>
          </>;
          if (unavailable) return <article key={title} className={styles.card}>{content}</article>;
          if (official) return <a key={title} className={styles.card} href={official.href} target="_blank" rel="noreferrer" aria-label={`前往${official.label}：《${title}》`}>{content}</a>;
          if (kind === 'archive') return null;
          return <button key={title} type="button" className={styles.card} onClick={() => onPick(title, contextForFilm(title, year, kind))} aria-label={`查找《${title}》（${year}）片源`}>{content}</button>;
        })}</div>
      </div>
    </li>)}</ol>
  </section>;
}

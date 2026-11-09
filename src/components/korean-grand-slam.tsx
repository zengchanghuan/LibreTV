'use client';

import { useState } from 'react';
import { grandSlamActors, grandSlamActorFilms, grandSlamSingleActors, koreanGrandSlamCollection, type GrandSlamActor } from '@/lib/korean-grand-slam';
import { cn } from '@/lib/utils';
import { FilmPoster } from './film-poster';
import { FilmCardDetails } from './film-card-details';

export function KoreanGrandSlam({ onPick }: { onPick: (title: string) => void }) {
  const [view, setView] = useState<'single' | 'actors'>('single');
  const [gender, setGender] = useState<'male' | 'female'>('male');
  const [selected, setSelected] = useState<Record<'male' | 'female', string>>({ male: grandSlamActors.find(a => a.gender === 'male')!.name, female: grandSlamActors.find(a => a.gender === 'female')!.name });
  const actors = grandSlamActors.filter(actor => actor.gender === gender);
  const activeActor = actors.find(actor => actor.name === selected[gender])!;
  const displayed = view === 'single' ? grandSlamSingleActors.map(name => grandSlamActors.find(a => a.name === name)!) : [activeActor];
  return <section aria-label="韩国大满贯">
    <h2 className="text-xl font-bold">韩国大满贯</h2>
    <p className="mt-1 text-sm text-muted">{koreanGrandSlamCollection.intro}</p>
    <div className="my-4 flex gap-2" aria-label="浏览方式">
      <Choice active={view === 'single'} onClick={() => setView('single')}>单片 {grandSlamSingleActors.length}</Choice>
      <Choice active={view === 'actors'} onClick={() => setView('actors')}>演员 {grandSlamActors.length}</Choice>
    </div>
    {view === 'actors' && <div className="mb-5 space-y-3">
      <div className="flex gap-2" aria-label="演员分类">
        {(['male', 'female'] as const).map(value => <Choice key={value} active={gender === value} onClick={() => setGender(value)}>
          {value === 'male' ? '男演员' : '女演员'} {grandSlamActors.filter(actor => actor.gender === value).length}
        </Choice>)}
      </div>
      <div className="flex flex-wrap gap-2" aria-label="选择演员">
        {actors.map(actor => <Choice key={actor.name} active={selected[gender] === actor.name} onClick={() => setSelected(previous => ({ ...previous, [gender]: actor.name }))}>{actor.name}</Choice>)}
      </div>
    </div>}
    <div className="grid grid-cols-2 items-start gap-x-3 gap-y-6 lg:grid-cols-4 lg:gap-x-5">
      {displayed.flatMap(actor => grandSlamActorFilms(actor).map(({ film, awards }) => <article key={`${actor.name}-${film.id}`}>
        <button type="button" onClick={() => onPick(film.title)} aria-label={`查找《${film.title}》片源`} className={cn("block aspect-[4/5] w-full overflow-hidden rounded-xl", film.posterLandscape && "bg-black [&_img]:object-contain")}>
          <FilmPoster title={film.title} year={String(film.year)} url={film.metadata.poster} mode="direct" imageAlt={film.coverKind === 'still' ? `${film.title}剧照` : undefined} />
        </button>
        <h3 className="mt-3 font-semibold leading-6">{film.title} <span className="text-xs font-normal text-muted">{film.year}</span></h3>
        <p className="mt-1 text-xs text-muted">{actor.name} · {actor.gender === 'male' ? '最佳男主角' : '最佳女主角'}</p>
        <p className="mt-2 text-sm text-accent">{awards.map(record => record.award).join(' · ')}</p>
        <details className="mt-3 text-xs text-muted">
          <summary className="cursor-pointer py-1">详情 · {film.metadata.rating ? `${film.metadata.ratingSource || '豆瓣'} ${film.metadata.rating}` : '评分暂缺'}</summary>
          <div className="mt-2 space-y-2 leading-6">
            <p>{awards.map(record => `${record.award} ${record.year}`).join(' · ')}</p>
            <p>{film.referenceTitle}{film.aliases.length > 0 && ` · 又名：${film.aliases.join(' / ')}`}</p>
            <FilmCardDetails metadata={film.metadata} year={film.year} />
            <p><External href={film.source}>影片资料</External>{film.metadata.rating && film.metadata.source !== film.source && <> · <External href={film.metadata.source!}>评分来源</External></>} · <AwardSources actor={actor} /></p>
          </div>
        </details>
        <button type="button" onClick={() => onPick(film.title)} className="mt-3 rounded-lg bg-chip px-3 py-2 text-xs hover:bg-hover">查找片源</button>
      </article>))}
    </div>
    <details className="mt-7 border-t border-line pt-4 text-xs leading-6 text-muted">
      <summary className="cursor-pointer">收录说明</summary>
      <div className="mt-3 space-y-2">
        <p>按提供片单收录，截至 2026 年 11 月 9 日。单片指同一演员凭同一部电影获得三奖；演员指凭不同电影集齐三奖。仅计电影最佳男／女主角，不计电视奖、新人奖、配角奖或大赏。演员页展示一组获奖代表作，非完整获奖履历，不设排名。</p>
        <p>片名旁为影片年份（含影展首映）；奖项旁为颁奖年份。部分早期电影尚无可核实评分；无海报时采用官方剧照或片名封面。</p>
        <p>特殊口径：《公共之敌》（2002，又名《人民公敌》）中薛景求获青龙、大钟最佳男主角及百想大赏，因大赏与最佳主角不同，单独附注，不计入上方四部。<External href="https://www.baeksangawards.co.kr/winners">百想历届获奖</External></p>
      </div>
    </details>
  </section>;
}
function Choice({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-pressed={active} onClick={onClick} className={cn('rounded-lg px-3 py-2 text-sm transition-colors', active ? 'bg-accent text-on-accent' : 'bg-chip text-muted hover:bg-hover hover:text-content')}>{children}</button>;
}
function External({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className="underline hover:text-content">{children}</a>;
}
function AwardSources({ actor }: { actor: GrandSlamActor }) {
  return <>{actor.sources.map((url, i) => <span key={url}>{i > 0 && ' · '}<External href={url}>获奖记录{actor.sources.length > 1 ? i + 1 : ''}</External></span>)}</>;
}

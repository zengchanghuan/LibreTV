import { koreanThrillers, zhangYanThrillers } from '@/lib/korean-thrillers';
import { FilmPosterGrid } from './film-poster-grid';

export function KoreanThrillers({ onPick, zhangYan }: { zhangYan: boolean; onPick: (title: string) => void }) {
  const films = zhangYan ? zhangYanThrillers : koreanThrillers;
  const heading = zhangYan ? '张燕版韩国政治惊悚片' : '韩国政治惊悚片必看榜';
  return <section aria-label={heading}>
    {!zhangYan && (
      <>
        <h2 className="text-xl font-bold">{heading}</h2>
        <p className="mb-4 mt-1 text-sm text-muted">共 {films.length} 部 · 按推荐观看顺序排列 · 选择影片搜索片源</p>
      </>
    )}
    <FilmPosterGrid onPick={onPick} films={films.map(([id, title, year, theme, cast, intro]) => ({
      id, title: zhangYan && id === 'devil' ? '对外秘密：权力的诞生' : title,
      searchTitle: title,
      year, theme, cast, intro, poster: `/posters/korean/${id}.jpg`,
    }))} />
  </section>;
}

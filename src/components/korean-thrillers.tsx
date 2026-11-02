import Image from 'next/image';

import { koreanThrillers as films } from '@/lib/korean-thrillers';

export function KoreanThrillers({ onPick }: { onPick: (title: string) => void }) {
  return <section aria-label="韩国政治惊悚片必看榜">
    <h2 className="text-xl font-bold">韩国政治惊悚片必看榜</h2>
    <p className="mb-4 mt-1 text-sm text-muted">共 {films.length} 部 · 按推荐观看顺序排列 · 选择影片搜索片源</p>
    <ol className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-6">
      {films.map(([id, title, year, theme, cast, intro], i) => <li key={id}>
        <button type="button" aria-label={`搜索《${title}》`} onClick={() => onPick(title)} className="group w-full text-left">
          <span className="relative block overflow-hidden rounded-lg bg-chip">
            <Image src={`/posters/korean/${id}.jpg`} alt="" width={264} height={377} className="aspect-[7/10] w-full object-cover" />
            <span className="absolute top-2 left-2 rounded bg-black/80 px-2 py-1 text-xs font-bold text-white">#{i + 1}</span>
          </span>
          <strong className="mt-2 block group-hover:text-accent">{title}</strong>
        </button>
        <p className="mt-1 text-xs text-muted">{year} · {theme}</p>
        <p className="my-1 text-sm">主演：{cast}</p>
        <p className="text-xs leading-relaxed text-muted">{intro}</p>
      </li>)}
    </ol>
  </section>;
}

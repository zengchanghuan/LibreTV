'use client';

import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { Header } from '@/components/header';
import { SiteFooter } from '@/components/site-footer';
import { LoadingState, ErrorState } from '@/components/states';
import { HD_RESOURCE_SITES } from '@/lib/hd-resource-sites';

function SiteCatalog({ site, expanded }: { site: typeof HD_RESOURCE_SITES[number]; expanded: boolean }) {
  const [pages, setPages] = useState<string[]>([site.url]);
  const url = pages[pages.length - 1];
  const query = useQuery({ queryKey: ['hd-resources', site.id, url], queryFn: ({ signal }) => api.hdCatalog(site.id, url, signal), staleTime: 600_000, retry: false });
  const items = query.data?.items || [];
  return <section aria-label={`${site.name}影片目录`} className="rounded-2xl border border-line bg-surface-raised p-4 sm:p-6 min-w-0">
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div><h2 className="text-lg font-semibold">{site.name}</h2><p className="text-xs text-muted mt-1">{site.description}</p></div>
      {!expanded && <Link href={`/hd?site=${site.id}`} className="btn min-h-11">查看目录</Link>}
    </div>
    {query.isPending && <LoadingState label="正在读取源站目录…" />}
    {query.isError && <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />}
    {query.data && <>
      <p className="text-xs text-muted mb-3">{expanded ? `第 ${pages.length} 页 · ${items.length} 部` : `本次读取 ${items.length} 部 · 展示前 ${Math.min(items.length, 6)} 部`} · 画质与下载方式请查看详情</p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {(expanded ? items : items.slice(0, 6)).map(item => <li key={item.url} className="min-w-0">
          <Link href={`/hd/${site.id}?url=${encodeURIComponent(item.url)}`} className="block h-full rounded-xl border border-line bg-surface p-4 hover:border-accent focus-visible:outline-accent">
            <h3 className="text-sm font-semibold leading-6 break-words">{item.title}</h3>
            {item.note && <p className="text-xs text-muted mt-2 leading-5 break-words">{item.note}</p>}
            <span className="inline-block text-xs text-accent mt-3">资源与下载方式 →</span>
          </Link>
        </li>)}
      </ul>
      {expanded && <div className="mt-5 flex flex-wrap gap-2">
        {pages.length > 1 && <button className="btn min-h-11" onClick={() => setPages(p => p.slice(0, -1))}>上一页</button>}
        {query.data.next && !pages.includes(query.data.next) && <button className="btn min-h-11" onClick={() => setPages(p => [...p, query.data!.next!])}>下一页</button>}
        {site.id === 'rrdynb' && pages.length === 1 && <button className="btn min-h-11" onClick={() => setPages(p => [...p, `${site.url}movie/`])}>浏览电影分类</button>}
      </div>}
    </>}
  </section>;
}

function HDContent() {
  const requested = useSearchParams().get('site');
  const selected = HD_RESOURCE_SITES.find(site => site.id === requested);
  return <div className="min-h-screen flex flex-col">
    <Header />
    <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6 space-y-5">
      <div><h1 className="text-2xl font-bold">高清专区</h1><p className="text-sm text-muted mt-2 leading-6">四站影片目录。查看版本、资源大小和下载方式。</p></div>
      <nav aria-label="高清资源网站" className="flex flex-wrap gap-2">
        {[{ id: '', name: '全部' }, ...HD_RESOURCE_SITES].map(site => <Link key={site.id} aria-current={(selected?.id || '') === site.id ? 'page' : undefined} className={`btn min-h-11 ${((selected?.id || '') === site.id) ? 'border-accent text-accent' : ''}`} href={site.id ? `/hd?site=${site.id}` : '/hd'}>{site.name}</Link>)}
      </nav>
      <p className="text-xs text-muted leading-5">磁力、种子和网盘资源需使用对应下载工具；这里的片单不代表已经验证可播放，也不保证每部都有 4K 版本。</p>
      {(selected ? [selected] : HD_RESOURCE_SITES).map(site => <SiteCatalog key={`${site.id}:${!!selected}`} site={site} expanded={!!selected} />)}
    </main><SiteFooter />
  </div>;
}
export default function HDPage() { return <Suspense><HDContent /></Suspense>; }

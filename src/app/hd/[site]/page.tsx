'use client';

import Link from 'next/link';
import { Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { Header } from '@/components/header';
import { SiteFooter } from '@/components/site-footer';
import { LoadingState, ErrorState } from '@/components/states';
import { useToast } from '@/components/toast';
import { hdResourceSite, type HDResourceDetail } from '@/lib/hd-resource-sites';

function ResourceDetail() {
  const params = useParams<{ site: string }>();
  const site = hdResourceSite(params.site), url = useSearchParams().get('url') || '';
  const { toast } = useToast();
  const query = useQuery<HDResourceDetail>({
    queryKey: ['hd-resource-detail', site?.id, url], enabled: !!site && !!url, staleTime: 600_000, retry: false,
    queryFn: ({ signal }) => api.hdResourceDetail(site!.id, url, signal),
  });
  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); toast('链接已复制，可粘贴到对应下载工具', 'success'); }
    catch { toast('复制失败，请长按下方链接复制', 'warning'); }
  };
  return <div className="min-h-screen flex flex-col"><Header />
    <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-6 space-y-5">
      <Link className="btn min-h-11 inline-flex items-center" href={site ? `/hd?site=${site.id}` : '/hd'}>← 返回{site?.name || '高清专区'}</Link>
      {(!site || !url) ? <ErrorState message="无效的资源页面" /> : query.isPending ? <LoadingState label="正在读取影片资源…" /> : query.isError ? <ErrorState message={query.error.message} onRetry={() => void query.refetch()} /> : query.data && <>
        <div><p className="text-xs text-muted mb-2">{site.name} · 资源详情</p><h1 className="text-xl font-bold leading-8 break-words">{query.data.title}</h1></div>
        {query.data.loginRequired && <p role="status" className="rounded-xl border border-line bg-chip p-4 text-sm leading-6">该影片需要登录原站后查看资源。请打开原站登录；HomeTV 不保存该站账号。</p>}
        {!!query.data.resources.length && <section aria-label="下载资源" className="space-y-3">
          <h2 className="font-semibold">资源与下载方式</h2>
          {query.data.resources.map(resource => <article key={resource.url} className="rounded-xl border border-line p-4 space-y-3 min-w-0">
            <span className="text-xs text-accent">{resource.kind}</span>
            <h3 className="text-sm leading-6 break-words">{resource.title}</h3>
            <p className="text-xs text-muted">{resource.kind === '网盘' ? '在对应网盘中打开，可按网盘提供的方式保存或下载。' : resource.kind === '磁力' || resource.kind === '种子' ? '复制链接到支持 BT 的下载工具。' : '文件格式和可用性以源站为准，复制链接到兼容的下载工具。'}</p>
            <div className="flex flex-wrap gap-2"><button className="btn min-h-11" onClick={() => void copy(resource.url)}>复制链接</button>
              {resource.kind === '网盘' && <a className="btn min-h-11 inline-flex items-center" href={resource.url} target="_blank" rel="noopener noreferrer">打开网盘 ↗</a>}
            </div>
            <p className="text-xs text-muted break-all select-all">{resource.url}</p>
          </article>)}
        </section>}
        {!query.data.resources.length && !query.data.loginRequired && <p className="text-sm text-muted">此页面暂未提取到公开下载链接，请到原站查看资源说明。</p>}
        <a className="btn min-h-11 inline-flex items-center" href={query.data.url} target="_blank" rel="noopener noreferrer">{query.data.loginRequired ? '打开原站登录 / 查看资源' : '查看原站详情'} ↗</a>
        {query.data.summary && !query.data.loginRequired && <details className="rounded-xl border border-line p-4"><summary className="cursor-pointer text-sm">影片介绍与原站资源说明</summary><p className="text-sm text-muted leading-7 mt-3 break-words whitespace-pre-wrap">{query.data.summary}</p></details>}
      </>}
    </main><SiteFooter />
  </div>;
}
export default function HDDetailPage() { return <Suspense><ResourceDetail /></Suspense>; }

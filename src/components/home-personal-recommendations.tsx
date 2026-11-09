'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { HomeRecommendations } from '@/lib/home-discovery-types';
import { homeRecommendationQueryKey, visibleHomeRecommendationBatch } from '@/lib/home-feedback-client';
import type { RecommendedWork } from '@/lib/recommendations';
import type { SourceConfig } from '@/lib/types';
import { useAppStore } from '@/lib/store';
import { useAuth } from './auth';
import { HomeFeedbackButtons, type useHomeFeedback } from './home-feedback';
import { RecommendedWorkCard } from './recommended-work-card';

export function HomePersonalRecommendations({ sources, feedback, onPick }: {
  sources: SourceConfig[]; feedback: ReturnType<typeof useHomeFeedback>;
  onPick: (work: RecommendedWork, tab: 'details' | 'sources') => void;
}) {
  const store = useAppStore(), { verified, username } = useAuth();
  const [batch, setBatch] = useState(0);
  // A feedback revision changes the key on polling too, so other devices' votes refresh this list.
  const query = useQuery({
    queryKey: homeRecommendationQueryKey(username, store.yellowFilter, feedback.items), enabled: feedback.ready && !feedback.saving,
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/home/recommendations?filterAdult=${store.yellowFilter}`, { signal, credentials: 'same-origin' });
      if (!response.ok) throw new Error('推荐暂时无法读取');
      return await response.json() as HomeRecommendations;
    }, staleTime: 60_000, retry: 1,
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey[1] === username
      && previousQuery.queryKey[2] === store.yellowFilter ? previous : undefined,
    refetchInterval: q => q.state.data?.aiStatus === 'pending' ? 10_000 : 60_000,
    refetchIntervalInBackground: false,
  });
  const batches = query.data?.batches || [], works = visibleHomeRecommendationBatch(query.data, feedback.items, batch);
  if (!verified) return null;
  return <section aria-label="猜你喜欢" className="mb-10">
    <div className="mb-4 flex items-center justify-between gap-3">
      <div><p className="mb-1 text-[10px] tracking-[0.18em] text-accent">PICKED FOR YOU</p><h2 className="text-xl font-semibold">猜你喜欢</h2>
        <p className="mt-1 text-xs leading-6 text-faint">{feedback.items.length ? '根据你的赞和踩调整选片，也留一些新口味。' : '从精选好片开始，点个赞或踩，让推荐更懂你。'}</p></div>
      {batches.length > 1 && <button type="button" className="btn-ghost btn-sm shrink-0" onClick={() => setBatch(i => i + 1)}>换一批 ↻</button>}
    </div>
    {query.isError ? <p role="status" className="rounded-xl bg-chip p-4 text-sm text-muted">推荐暂时加载失败。<button type="button" className="btn-ghost btn-sm" onClick={() => void query.refetch()}>重试</button></p>
      : works.length ? <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-6">{works.map(work => <div key={work.id} className="relative min-w-0">
        <RecommendedWorkCard work={work} sources={sources} filterAdult={store.yellowFilter} enabled={false} hideUnknownType imageMode={store.imageProxyMode} customProxy={store.customImageProxy} onPick={onPick} />
        <HomeFeedbackButtons title={work.title} value={feedback.voteFor(work.id)} disabled={feedback.disabled} pending={feedback.pendingId === work.id} onVote={vote => feedback.vote(work.id, vote)} />
      </div>)}</div> : <p role="status" className="rounded-xl bg-chip p-4 text-sm text-muted">{feedback.unavailable ? '读取喜好后即可为你选片。' : query.isPending ? '正在为你挑选影片…' : '暂时没有合适的影片，稍后再来看看。'}</p>}
  </section>;
}

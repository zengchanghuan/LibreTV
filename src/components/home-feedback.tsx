'use client';

import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { nextHomeVote, type HomeContentKind, type HomeFeedbackResponse, type HomeFeedbackUpdateResponse, type HomeVote } from '@/lib/home-feedback-types';
import { homeRecommendationQueryKey, optimisticHomeFeedback } from '@/lib/home-feedback-client';
import { homeContentKinds, homeFeedbackFilter } from '@/lib/home-content-preferences';
import type { RecommendedWork } from '@/lib/recommendations';
import { useAppStore } from '@/lib/store';
import { useAuth } from './auth';
import { useToast } from './toast';

export function useHomeFeedback() {
  const { verified, username, openLogin } = useAuth(), { toast } = useToast();
  const filterAdult = useAppStore(state => state.yellowFilter);
  const client = useQueryClient(), queryKey = ['home-feedback', username];
  const saving = useIsMutating({ mutationKey: queryKey }) > 0;
  const query = useQuery({
    // Polling/focus reads must not replace an optimistic vote with the older saved state.
    queryKey, enabled: verified && !saving,
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/home/feedback', { signal, credentials: 'same-origin' });
      if (!response.ok) throw new Error('喜好记录暂时无法读取');
      return await response.json() as HomeFeedbackResponse;
    }, staleTime: 30_000, refetchInterval: 60_000, refetchOnWindowFocus: true,
  });
  const mutation = useMutation({
    mutationKey: queryKey,
    scope: { id: 'home-feedback' },
    mutationFn: async ({ workId, vote }: { workId: string; vote: HomeVote | null; contentKinds?: HomeContentKind[] }) => {
      const response = await fetch('/api/home/feedback', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workId, vote, filterAdult }) });
      if (!response.ok) {
        if (response.status === 401) openLogin();
        throw new Error('保存失败，请重试');
      }
      return await response.json() as HomeFeedbackUpdateResponse;
    },
    onMutate: async ({ workId, vote, contentKinds }) => {
      await Promise.all([client.cancelQueries({ queryKey }), client.cancelQueries({ queryKey: ['home-personal-recommendations'] }), client.cancelQueries({ queryKey: ['home-discovery-v2'] })]);
      const snapshot = client.getQueryData<HomeFeedbackResponse>(queryKey) || { items: [] };
      client.setQueryData(queryKey, optimisticHomeFeedback(snapshot, workId, vote, Date.now(), contentKinds));
      return { snapshot, previous: snapshot.items.find(item => item.workId === workId)?.vote ?? null };
    },
    onSuccess: async (data, { workId, vote, contentKinds }, context) => {
      await client.cancelQueries({ queryKey: ['home-personal-recommendations'] });
      // Seed the confirmed revision before rendering it; no second network round trip is needed.
      if (data.recommendations) client.setQueryData(
        homeRecommendationQueryKey(username, filterAdult, data.items, data.recommendations.day), data.recommendations);
      client.setQueryData(queryKey, { items: data.items });
      toast(vote === 'like' ? data.recommendations ? '已点赞，推荐已更新' : '已点赞，正在更新推荐'
        : vote === 'dislike' ? '已点踩，已移除并更新列表' : '已取消反馈', 'success', {
        action: { label: '撤销', onClick: () => mutation.mutate({ workId, vote: context?.previous ?? null, contentKinds }) },
      });
      if (!data.recommendations) await client.invalidateQueries({ queryKey: ['home-personal-recommendations'] });
    },
    onError: (_error, _variables, context) => {
      if (context) client.setQueryData(queryKey, context.snapshot);
      toast('保存失败，请重试，已恢复原有选择和列表', 'error');
    },
  });
  const items = verified ? query.data?.items || [] : [];
  const voteFor = (workId: string) => items.find(item => item.workId === workId)?.vote;
  return {
    items, voteFor, allows: homeFeedbackFilter(items), saving: mutation.isPending, ready: verified && Boolean(query.data), unavailable: verified && query.isError, retry: () => void query.refetch(),
    disabled: !verified || !query.data || mutation.isPending,
    pendingId: mutation.isPending ? mutation.variables.workId : undefined,
    vote: (work: RecommendedWork, clicked: HomeVote) => {
      if (!verified) { openLogin(); return; }
      if (mutation.isPending || !query.data) return;
      mutation.mutate({ workId: work.id, vote: nextHomeVote(voteFor(work.id), clicked), contentKinds: homeContentKinds(work) });
    },
  };
}

export function HomeFeedbackButtons({ title, value, disabled, pending, onVote }: {
  title: string; value?: HomeVote; disabled: boolean; pending: boolean; onVote: (vote: HomeVote) => void;
}) {
  // The card is the positioning parent. Match its poster ratio without taking layout space.
  return <div className="pointer-events-none absolute inset-x-0 top-0 aspect-[2/3]">
    <div className="pointer-events-auto absolute bottom-2 right-2 flex items-center gap-1 rounded-lg bg-black/80 p-1 shadow-sm backdrop-blur-sm" role="group" aria-label={`《${title}》的选片偏好`} aria-busy={pending}>
    {(['like', 'dislike'] as const).map(vote => {
      const selected = value === vote, label = vote === 'like' ? '点赞' : '点踩';
      return <button key={vote} type="button" aria-label={`${selected ? '取消' : ''}${label}《${title}》`} aria-pressed={selected}
        title={selected ? `取消${label}` : vote === 'like' ? '喜欢，多推荐类似影片' : '不喜欢，减少类似推荐'}
        disabled={disabled} onClick={() => onVote(vote)}
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 disabled:cursor-wait disabled:opacity-50 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 ${selected ? vote === 'like' ? 'bg-sky-400/20 text-sky-300' : 'bg-red-400/20 text-red-300' : 'text-white/90 hover:bg-white/10 hover:text-white'}`}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill={selected ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={vote === 'dislike' ? 'rotate-180' : undefined}>
          <path d="M7 10v11H3V10h4Zm0 0 5-8a3 3 0 0 1 3 3l-1 5h5a2 2 0 0 1 2 2.4l-1.4 7A2 2 0 0 1 17.6 21H7" />
        </svg>
      </button>;
    })}
    <span className="sr-only" role="status">{pending ? '保存中' : value === 'like' ? '已赞' : value === 'dislike' ? '已踩' : ''}</span>
    </div>
  </div>;
}

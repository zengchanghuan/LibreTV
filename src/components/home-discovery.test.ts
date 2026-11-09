import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiscoveryResponse } from '@/lib/discovery-types';
import { discoveryStarters } from '@/lib/discovery-starters';
import { HomeDiscovery } from './home-discovery';
import { FilmPoster } from './film-poster';
import { homeFeedbackFilter } from '@/lib/home-content-preferences';
import type { HomeFeedback } from '@/lib/home-feedback-types';

const state = vi.hoisted(() => ({ data: undefined as DiscoveryResponse | undefined, isLoading: true, isError: false, dislikes: new Set<string>(), feedback: [] as HomeFeedback[] }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ ...state, refetch: vi.fn() }) }));
vi.mock('@/lib/store', () => ({ useAppStore: () => ({ yellowFilter: true, imageProxyMode: 'direct', customImageProxy: '' }) }));
vi.mock('./auth', () => ({ useAuth: () => ({ verified: true }) }));
vi.mock('./home-continue', () => ({ HomeContinue: () => null }));
vi.mock('./recommended-work-card', () => ({ RecommendedWorkCard: () => null }));
vi.mock('./recommended-work-sources', () => ({ RecommendedWorkSources: () => null }));
vi.mock('./home-feedback', async original => ({ ...await original<typeof import('./home-feedback')>(), useHomeFeedback: () => ({ items: state.feedback, allows: homeFeedbackFilter([...state.feedback, ...[...state.dislikes].map(workId => ({ workId, vote: 'dislike' as const, updatedAt: 1 }))]), voteFor: (id: string) => state.dislikes.has(id) ? 'dislike' : undefined, disabled: false, vote: vi.fn() }) }));
vi.mock('./home-personal-recommendations', () => ({ HomePersonalRecommendations: () => null }));
const render = () => renderToStaticMarkup(createElement(HomeDiscovery, { sources: [], onCollection: () => {}, charts: null }));
const empty = (): DiscoveryResponse => ({ recent: { new: [], series: [], added: [] }, refreshedAt: null, partial: false, stale: false, loading: false, popular: [], popularStatus: 'collecting', editorial: [], enabled: { recent: true, popular: true, editorial: true } });
beforeEach(() => { state.data = undefined; state.isLoading = true; state.isError = false; state.dislikes.clear(); state.feedback = []; });
describe('home discovery cold start', () => {
  it('renders actionable real films before the first response, with no blank skeleton cards', () => {
    const html = render();
    expect(html).toContain('查看《枪火》的影片详情');
    expect(html).toContain('查找片源');
    expect(html).toContain('先看这些');
    expect(html).not.toContain('animate-pulse');
    expect(html).not.toContain('精选片单暂不可用');
  });
  it('keeps curated cards on empty and failed responses without claiming new releases or popular ranks', () => {
    state.data = empty(); state.isLoading = false;
    for (const failed of [false, true]) {
      state.isError = failed; const html = render();
      expect(html).toContain('精选推荐');
      expect(html).toContain('查看《黄飞鸿》的影片详情');
      expect(html).not.toContain('多位观众有效观看');
      expect(html).not.toContain('已收录 1 个片源');
    }
  });
  it('replaces starters with actual popular results and respects disabled modules', () => {
    state.data = { ...empty(), popular: [discoveryStarters[0]], popularStatus: 'ready' }; state.isLoading = false;
    expect(render()).toContain('多位观众有效观看');
    expect(render()).not.toContain('START WATCHING');
    state.data.enabled = { recent: false, popular: false, editorial: false };
    expect(render()).not.toContain('精选推荐');
    expect(render()).not.toContain('当城市入夜');
  });
  it('keeps a title and year behind both missing and pending poster images', () => {
    for (const url of [undefined, 'https://example.com/missing.jpg']) {
      const html = renderToStaticMarkup(createElement(FilmPoster, { title: '测试影片', year: '1999', url, mode: 'direct' }));
      expect(html).toContain('测试影片'); expect(html).toContain('1999'); expect(html).toContain('bg-gradient-to-br');
    }
  });
  it.each(['new', 'series', 'added'] as const)('puts accessible feedback controls on %s cards', tab => {
    state.data = empty(); state.isLoading = false;
    state.data.recent[tab] = [{ work: discoveryStarters[0], sourceCount: 2, date: '2026-11-09T00:00:00Z', label: '更新至 12 集' }];
    const html = render();
    expect(html).toContain(`点赞《${discoveryStarters[0].title}》`);
    expect(html).toContain(`点踩《${discoveryStarters[0].title}》`);
    expect(html).toContain('aria-pressed="false"');
  });
  it.each(['new', 'series', 'added'] as const)('immediately removes disliked %s cards and fills the six visible places without deleting metadata', tab => {
    state.data = empty(); state.isLoading = false;
    state.data.recent[tab] = discoveryStarters.slice(0, 7).map(work => ({ work, sourceCount: 2, date: '2026-11-09T00:00:00Z', label: '更新至 12 集' }));
    const recent = () => render().split('aria-label="近期内容"')[1].split('</section>')[0];
    expect(recent()).toContain(`点踩《${discoveryStarters[0].title}》`);
    expect(recent()).not.toContain(`点踩《${discoveryStarters[6].title}》`);
    state.dislikes.add(discoveryStarters[0].id);
    const html = recent();
    expect(html).not.toContain(`点踩《${discoveryStarters[0].title}》`);
    expect(html).toContain(`点踩《${discoveryStarters[6].title}》`);
    expect(html.match(/<article /g)).toHaveLength(6);
    expect(html.match(/已收录 2 个片源/g)).toHaveLength(6);
    expect(html).toContain(discoveryStarters[1].year);
    expect(html).toContain(tab === 'series' ? '更新至 12 集' : tab === 'new' ? '11/9 上线' : '11/9 收录');
    state.dislikes.clear();
    expect(recent()).toContain(`点踩《${discoveryStarters[0].title}》`);
  });
  it.each(['new', 'series', 'added'] as const)('filters a rejected format before selecting the six visible %s cards', tab => {
    state.data = empty(); state.isLoading = false;
    const anime = { ...discoveryStarters[0], id: 'new-anime', title: '未点踩过的新动漫', mediaType: 'animation' as const, genres: ['日韩动漫'] };
    state.data.recent[tab] = [anime, ...discoveryStarters.slice(0, 6)].map(work => ({ work, sourceCount: 2, date: '2026-11-09T00:00:00Z', label: '更新至 12 集' }));
    state.feedback = ['old-1', 'old-2'].map(workId => ({ workId, vote: 'dislike', updatedAt: 1, contentKinds: ['animation'] }));
    const html = render().split('aria-label="近期内容"')[1].split('</section>')[0];
    expect(html).not.toContain(anime.title);
    expect(html.match(/<article /g)).toHaveLength(6);
    expect(html).toContain(discoveryStarters[5].title);
  });
});

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiscoveryResponse } from '@/lib/discovery-types';
import { discoveryStarters } from '@/lib/discovery-starters';
import { HomeDiscovery } from './home-discovery';
import { FilmPoster } from './film-poster';

const state = vi.hoisted(() => ({ data: undefined as DiscoveryResponse | undefined, isLoading: true, isError: false }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ ...state, refetch: vi.fn() }) }));
vi.mock('@/lib/store', () => ({ useAppStore: () => ({ yellowFilter: true, imageProxyMode: 'direct', customImageProxy: '' }) }));
vi.mock('./auth', () => ({ useAuth: () => ({ verified: true }) }));
vi.mock('./home-continue', () => ({ HomeContinue: () => null }));
vi.mock('./recommended-work-card', () => ({ RecommendedWorkCard: () => null }));
vi.mock('./recommended-work-sources', () => ({ RecommendedWorkSources: () => null }));
const render = () => renderToStaticMarkup(createElement(HomeDiscovery, { sources: [], onCollection: () => {}, charts: null }));
const empty = (): DiscoveryResponse => ({ recent: { new: [], series: [], added: [] }, refreshedAt: null, partial: false, stale: false, loading: false, popular: [], popularStatus: 'collecting', editorial: [], enabled: { recent: true, popular: true, editorial: true } });
beforeEach(() => { state.data = undefined; state.isLoading = true; state.isError = false; });
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
});

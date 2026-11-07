import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import { matchWorkSources } from '@/lib/recommendation-resources';
import { signSession, SESSION_COOKIE } from '@/lib/auth';
vi.mock('@/lib/recommendation-resources', () => ({ matchWorkSources: vi.fn() }));
const work = { title: '老男孩', year: '2003', mediaType: 'movie' };
const source = { key: 'a', name: 'A', url: 'https://a.example/' };
const request = (data: unknown, auth = true) => new Request('https://app.example/api/recommendations/resources', {
  method: 'POST', body: JSON.stringify(data), headers: auth ? { cookie: `${SESSION_COOKIE}=${signSession().token}` } : {},
});
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('PASSWORD', 'work-resource-test-only'); });
afterEach(() => vi.unstubAllEnvs());
describe('resource matching API', () => {
  it('rejects unauthenticated and malformed work/source requests before fetching', async () => {
    expect((await POST(request({ work, sources: [source] }, false))).status).toBe(401);
    for (const data of [null, {}, { work, sources: [] }, { work, sources: Array(7).fill(source) },
      { work: { ...work, year: '' }, sources: [source] }, { work, sources: [{ ...source, url: 'file:///etc/passwd' }] }]) {
      expect((await POST(request(data))).status).toBe(400);
    }
    expect(matchWorkSources).not.toHaveBeenCalled();
  });
  it('deduplicates endpoint URLs and passes a cancellation signal', async () => {
    vi.mocked(matchWorkSources).mockResolvedValue({ items: [], checked: 1, failures: [] });
    const res = await POST(request({ work, sources: [source, { ...source, key: 'duplicate' }] }));
    expect(res.status).toBe(200);
    expect(matchWorkSources).toHaveBeenCalledWith(expect.objectContaining(work), [{ ...source, isAdult: false }], true, expect.any(AbortSignal), false);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
  it('enriches metadata only when explicitly requested by a card', async () => {
    vi.mocked(matchWorkSources).mockResolvedValue({ items: [], checked: 1, failures: [] });
    await POST(request({ work, sources: [source], includeMetadata: true }));
    expect(matchWorkSources).toHaveBeenCalledWith(expect.any(Object), expect.any(Array), true, expect.any(AbortSignal), true);
  });
});

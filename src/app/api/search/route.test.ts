import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import { SESSION_COOKIE, signSession } from '@/lib/auth';
import { contextForFilm } from '@/lib/work-search';
import { aggregateResults } from '@/lib/search-result-groups';

/**
 * 聚合搜索接口单测：跨源聚合、同源去重、精确命中置顶、成人内容过滤、
 * 失败源不影响整体、SSRF 字面量拒绝。上游一律 mock fetch，无真实网络。
 */

function cmsList(items: Array<Record<string, unknown>>, pagecount = 1): string {
  return JSON.stringify({ code: 1, pagecount, list: items });
}

/** 按 URL 分发的上游 mock：cms-a 正常、cms-b 500、cms-c 与 a 有重叠条目 */
function mockUpstream(): void {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('cms-a.example')) {
      return new Response(
        cmsList([
          { vod_id: 1, vod_name: '测试剧', type_name: '国产剧' },
          { vod_id: 2, vod_name: '测试剧外传', type_name: '国产剧' },
          { vod_id: 3, vod_name: '福利速递', type_name: '福利视频' },
          // 同源同 vod_id 的重复条目：聚合时须按 sourceKey_vodId 去重
          { vod_id: 1, vod_name: '测试剧', type_name: '国产剧' },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    if (url.includes('cms-b.example')) {
      return new Response('server error', { status: 500 });
    }
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fn);
}

function makeRequest(body: unknown, stream = false): Request {
  const { token } = signSession();
  return new Request(`https://local.test/api/search${stream ? '?stream=1' : ''}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie: `${SESSION_COOKIE}=${token}`,
    },
    body: JSON.stringify(body),
  });
}

const SOURCES = [
  { key: 'a', name: '源A', url: 'https://cms-a.example.com/api.php' },
  { key: 'b', name: '源B', url: 'https://cms-b.example.com/api.php' },
];

beforeAll(() => {
  process.env.PASSWORD = 'test-password-123';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/search', () => {
  it.each([false, true])('searches common and literal titles with year/type boundaries and the same cached result (stream=%s)', async stream => {
    const source = { key: `alias-${stream}`, name: '别名测试源', url: `https://alias-${stream}.example.com/api.php` };
    const original = '光海，成为王的男人';
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.searchParams.get('ids')) return new Response(cmsList([
        { vod_id: 4, vod_name: '双面君王', vod_year: '2019', type_name: '电影' },
      ]));
      const common = url.searchParams.get('wd') === '双面君王';
      return new Response(cmsList([
        { vod_id: common ? 2 : 1, vod_name: common ? '双面君王' : original, vod_year: '2012', type_name: '电影' },
        { vod_id: 3, vod_name: '双面君王', vod_year: '2019', type_name: '韩国剧' },
        { vod_id: 4, vod_name: '双面君王', vod_year: '2019', type_name: '电影' },
      ]));
    });
    vi.stubGlobal('fetch', fetchSpy);
    const body = { wd: original, context: contextForFilm(original, 2012, 'movie'), sources: [source] };
    const response = await POST(makeRequest(body, stream));
    const events = stream ? (await response.text()).trim().split('\n').map(s => JSON.parse(s)) : [];
    const data = stream ? events.at(-1) : await response.json();
    expect(data.list.map((i: { vodId: string }) => i.vodId).sort()).toEqual(['1', '2']);
    expect(aggregateResults(data.list)).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    if (stream) {
      expect(events.filter(e => e.type === 'source')).toHaveLength(1);
      expect(events.filter(e => e.type === 'progress')).toHaveLength(2);
      expect(events.filter(e => e.type === 'source')[0].list).toEqual(data.list);
    }
    fetchSpy.mockClear();
    const cached = await POST(makeRequest(body, true));
    const cachedEvents = (await cached.text()).trim().split('\n').map(s => JSON.parse(s));
    expect(cachedEvents).toHaveLength(1); expect(cachedEvents[0].list).toEqual(data.list);
    expect(fetchSpy).not.toHaveBeenCalled();
    const broad = await POST(makeRequest({ wd: original, sources: [source] }));
    const broadData = await broad.json();
    expect(broadData.list.some((i: { vodId: string }) => i.vodId === '3')).toBe(true);
    expect(broadData.list.find((i: { vodId: string }) => i.vodId === '4').identityUnconfirmed).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(3); // Two titles plus one conflicting metadata lookup.
  });

  it('keeps one successful name when the other fails and does not cache an incomplete response', async () => {
    const original = '光海，成为王的男人';
    const source = { key: 'partial-alias', name: '部分源', url: 'https://partial-alias.example.com/api.php' };
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => new URL(String(input)).searchParams.get('wd') === original
      ? new Response(cmsList([{ vod_id: 1, vod_name: original, vod_year: '2012', type_name: '电影' }]))
      : new Response('failed', { status: 500 }));
    vi.stubGlobal('fetch', fetchSpy);
    const body = { wd: original, context: contextForFilm(original, 2012, 'movie'), sources: [source] };
    const events = (await (await POST(makeRequest(body, true))).text()).trim().split('\n').map(s => JSON.parse(s));
    expect(events.filter(e => e.type === 'source')).toHaveLength(1);
    expect(events.find(e => e.type === 'source')).toMatchObject({ ok: true, partial: true });
    expect(events.at(-1).list).toHaveLength(1);
    expect(events.at(-1).failures[0]).toMatchObject({ partial: true });
    fetchSpy.mockClear();
    await POST(makeRequest(body)); expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('validates malformed keywords, unknown work IDs and contradictory year/type before fetching', async () => {
    vi.stubGlobal('fetch', vi.fn());
    for (const body of [null, { wd: 123, sources: SOURCES },
      { wd: 'x', sources: SOURCES, context: { workId: 'fake' } },
      { wd: '双面君王', sources: SOURCES, context: { workId: 'tmdb:movie:133200', year: '2019' } }]) {
      expect((await POST(makeRequest(body))).status).toBe(400);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([false, true])('季数查询以系列名召回，分页和流式结果均排除错误季数（stream=%s）', async stream => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.searchParams.get('ids')) return new Response(cmsList([
        { vod_id: Number(url.searchParams.get('ids')), vod_name: '鱿鱼游戏第二季', vod_year: '2024', type_name: '韩国剧' },
      ]));
      expect(url.searchParams.get('wd')).toBe('鱿鱼游戏');
      return new Response(cmsList(url.searchParams.get('pg') === '1' ? [
        { vod_id: 11, vod_name: '鱿鱼游戏第一季' },
        { vod_id: 12, vod_name: '鱿鱼游戏第二季' },
        { vod_id: 13, vod_name: '鱿鱼和鲸' },
      ] : [{ vod_id: 14, vod_name: '鱿鱼游戏 第2季' }], 2));
    });
    vi.stubGlobal('fetch', fetchSpy);
    const res = await POST(makeRequest({ wd: stream ? '鱿鱼游戏第二季' : '鱿鱼游戏2', sources: [SOURCES[0]] }, stream));
    if (stream) {
      const events = (await res.text()).trim().split('\n').map(line => JSON.parse(line));
      expect(events.map(e => e.type)).toEqual(['source', 'done']);
      for (const event of events) expect(event.list.map((i: { vodId: string }) => i.vodId).sort()).toEqual(['12', '14']);
    } else {
      const data = await res.json();
      expect(data.list.map((i: { vodId: string }) => i.vodId).sort()).toEqual(['12', '14']);
    }
    expect(fetchSpy).toHaveBeenCalledTimes(4); // Two pages plus two missing metadata lookups.
  });

  it('聚合多源结果：同源去重、成人内容过滤、失败源进 failures', async () => {
    mockUpstream();
    const res = await POST(makeRequest({ wd: '测试剧', sources: SOURCES, filterAdult: true }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      list: Array<{ sourceKey: string; vodId: string; name: string }>;
      failures: Array<{ sourceKey: string; error: string }>;
    };

    // 源A 的 4 条 → 去重后 2 条有效 + 成人条目被过滤
    const aItems = data.list.filter((i) => i.sourceKey === 'a');
    expect(aItems).toHaveLength(2);
    expect(aItems.map((i) => i.vodId).sort()).toEqual(['1', '2']);

    // 源B 500 → 记入 failures，不影响源A 的结果
    expect(data.failures).toHaveLength(1);
    expect(data.failures[0].sourceKey).toBe('b');
    expect(data.failures[0].error).toContain('500');
  });

  it('精确命中（忽略标点差异）排在最前', async () => {
    mockUpstream();
    const res = await POST(makeRequest({ wd: '测试剧', sources: [SOURCES[0]], filterAdult: true }));
    const data = (await res.json()) as { list: Array<{ name: string }> };
    expect(data.list[0]?.name).toBe('测试剧');
  });

  it('内网字面量地址在发起请求前被 SSRF 校验拒绝', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const res = await POST(
      makeRequest({
        wd: 'x',
        sources: [{ key: 'evil', name: '内网', url: 'http://192.168.1.100/api.php' }],
        filterAdult: false,
      })
    );
    const data = (await res.json()) as { failures: Array<{ sourceKey: string; error: string }> };
    expect(data.failures[0]?.sourceKey).toBe('evil');
    // 上游一次请求都不应发生
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('stream=1 以 NDJSON 逐源推送并以 done 事件收尾', async () => {
    mockUpstream();
    // 用不同关键词避开同键短缓存（缓存命中时只推 done 事件，见 route.ts 缓存分支）
    const res = await POST(makeRequest({ wd: '流式检测关键词', sources: SOURCES, filterAdult: true }, true));
    expect(res.status).toBe(200);
    const text = await res.text();
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { type: string; sourceKey?: string });
    const sources = lines.filter((l) => l.type === 'source');
    const done = lines.filter((l) => l.type === 'done');
    // 每个源恰好一条 source 事件（含失败的源B），最后一条是 done
    expect(sources.map((l) => l.sourceKey).sort()).toEqual(['a', 'b']);
    expect(done).toHaveLength(1);
    expect(lines[lines.length - 1].type).toBe('done');
  });

  it('未登录返回 401，未配置密码返回 503', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const saved = process.env.PASSWORD;
    delete process.env.PASSWORD;
    try {
      const noPassword = await POST(makeRequest({ wd: 'x', sources: SOURCES }));
      expect(noPassword.status).toBe(503);
    } finally {
      process.env.PASSWORD = saved;
    }
    const noCookie = new Request('https://local.test/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wd: 'x', sources: SOURCES }),
    });
    const unauthorized = await POST(noCookie);
    expect(unauthorized.status).toBe(401);
  });
});

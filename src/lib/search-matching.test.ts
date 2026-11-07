import { describe, expect, it } from 'vitest';
import { isRelevant, prepareSearchResults, searchTitleKey, searchUpstreamTerm } from './cms-parser';
import { aggregateResults } from './search-result-groups';
import type { SearchResultItem } from './types';

const item = (name: string, id: string, extra: Partial<SearchResultItem> = {}): SearchResultItem => ({
  name, vodId: id, sourceKey: 'a', sourceName: '源A', year: '2024', typeName: '韩国剧', ...extra,
});

describe('季数与续集搜索', () => {
  it.each(['鱿鱼游戏2', '鱿鱼游戏 ２', '鱿鱼游戏第二季', '鱿鱼游戏: 第2季', '鱿鱼游戏 S02', '鱿鱼游戏 Season 2'])('统一 %s 的召回和匹配', query => {
    expect(searchUpstreamTerm(query)).toBe('鱿鱼游戏');
    for (const title of ['鱿鱼游戏2', '鱿鱼游戏 第2季', '鱿鱼游戏第二季', '鱿鱼游戏 S02']) {
      expect(isRelevant(title, query)).toBe(true);
      expect(searchTitleKey(title)).toBe(searchTitleKey(query));
    }
    for (const title of ['鱿鱼游戏', '鱿鱼游戏第一季', '鱿鱼游戏第三季', '鱿鱼游戏20', '鱿鱼游戏第十二季', '鱿鱼游戏：真人挑战赛第二季', '墨鱼游戏2', '鱿鱼和鲸']) {
      expect(isRelevant(title, query)).toBe(false);
    }
  });
  it('支持两位季数与电影续集，明确的季和部不混同', () => {
    expect(isRelevant('生活大爆炸第十二季', '生活大爆炸12')).toBe(true);
    expect(isRelevant('阿凡达第二部', '阿凡达2')).toBe(true);
    expect(isRelevant('测试第二部', '测试第二季')).toBe(false);
    expect(isRelevant('鱿鱼游戏第二季[电影解说]', '鱿鱼游戏2 解说')).toBe(true);
  });
  it.each(['1984', '1917', '三体', '大明1566', '2001太空漫游', '恋爱24小时', '钢铁侠 2008', '007', 'F1'])('不误拆年份或数字片名 %s', query => {
    expect(searchUpstreamTerm(query)).toBe(query);
    expect(isRelevant(query, query)).toBe(true);
  });
  it('无关条目不会兜底出现，正片排在解说前，重复来源去重', () => {
    const list = [item('鱿鱼游戏2[电影解说]', '1'), item('鱿鱼和鲸', '2'),
      item('鱿鱼游戏第二季', '3'), item('鱿鱼游戏 第2季', '4'), item('鱿鱼游戏第一季', '5')];
    const result = prepareSearchResults([...list, list[2]], '鱿鱼游戏2');
    expect(result).toHaveLength(3);
    expect(result.at(-1)?.vodId).toBe('1');
    expect(prepareSearchResults(list, '不存在的电影')).toEqual([]);
    expect(prepareSearchResults([item('', '6')], '鱿鱼游戏2')).toEqual([]);
  });
  it('同季异写合并来源，保留年份、内容分类和衍生版本的边界', () => {
    const groups = aggregateResults([
      item('鱿鱼游戏第二季', '1'), item('鱿鱼游戏 第2季', '2'), item('鱿鱼游戏2', '3'),
      item('鱿鱼游戏第二季', '4', { year: '2025' }),
      item('鱿鱼游戏 第2季', '5', { typeName: '综艺' }),
      item('鱿鱼游戏第二季[电影解说]', '6', { typeName: '电影解说' }),
      item('鱿鱼游戏第三季', '7'),
    ]);
    expect(groups).toHaveLength(5);
    expect(groups[0].items.map(i => i.vodId)).toEqual(['1', '2', '3']);
    expect(new Set(groups.map(g => g.key)).size).toBe(5);
  });
});

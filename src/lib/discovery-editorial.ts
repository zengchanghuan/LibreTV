import { recommendationCatalog } from './recommendation-catalog';
import { isAdultContent } from './cms-parser';
import { homeDay } from './home-discovery-types';
import type { EditorialIssue } from './discovery-types';

/** Versioned, human-reviewed publications. Model output is never read from drafts here. */
export const editorialManifest = [
  { id: 'city-night', title: '当城市入夜', intro: '从街头的偶遇到无声的对峙，看城市里的人如何选择自己的路。',
    films: ['枪火|1999', '暗花|1998', '暗战|1999', '文雀|2008', '出租车司机|1976', '穷街陋巷|1973'] },
  { id: 'money-choices', title: '金钱背后的选择', intro: '从交易大厅到普通人的生活，六部电影看利益、欲望与代价。',
    films: ['大空头|2015', '商海通牒|2011', '大而不倒|2011', '华尔街|1987', '99个家|2014', '夺命金|2011'] },
  { id: 'swords-and-people', title: '江湖，也是人间', intro: '刀剑之外，侠义与日常、承诺与命运才是故事的重心。',
    films: ['新龙门客栈|1992', '黄飞鸿|1991', '剑雨|2010', '七武士|1954', '黄昏的清兵卫|2002', '隐剑鬼爪|2004'] },
];
export function publishedEditorial(now = Date.now()): EditorialIssue[] {
  const day = homeDay(now), dayIndex = Math.floor(Date.parse(day + 'T00:00:00Z') / 86400_000);
  const week = Math.floor((dayIndex + 3) / 7);
  const monday = new Date((week * 7 - 3) * 86400_000).toISOString().slice(0, 10);
  return editorialManifest.map((_, i) => editorialManifest[(week % editorialManifest.length + i) % editorialManifest.length]).map(issue => ({
    id: issue.id, title: issue.title, intro: issue.intro, publishedAt: monday,
    works: issue.films.flatMap(key => {
      const work = recommendationCatalog.find(w => `${w.title}|${w.year}` === key);
      if (!work?.poster || !work.metadata?.source || isAdultContent(work.genres.join(',')) || /情色/.test(work.genres.join(','))) return [];
      return [{ ...work, reasons: [issue.intro] }];
    }),
  })).filter(issue => issue.works.length >= 4);
}

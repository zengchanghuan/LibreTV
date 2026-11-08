import type { FilmCollection } from './film-collections';

/**
 * Naver nereid 的三篇 TOP 30 合并，按原文名次升序，观影人次单位为万。
 * 这是原文的历史榜单，不是实时票房收入排名；不复制文章影评。
 * 原文将《实尾岛》标为 2009，影片年份按 KOFIC 校正为 2003：
 * https://m.koreanfilm.or.kr/eng/films/index/filmsView.jsp?movieCd=20030410
 */
const rankedFilms: [title: string, year: number, admissions: number][] = [
  ['鸣梁海战', 2014, 1761],
  ['极限职业', 2019, 1626],
  ['与神同行：罪与罚', 2017, 1441],
  ['国际市场', 2014, 1425],
  ['老手', 2015, 1341],
  ['首尔之春', 2023, 1312],
  ['汉江怪物', 2006, 1301],
  ['夺宝联盟', 2012, 1298],
  ['7号房的礼物', 2013, 1281],
  ['暗杀', 2015, 1270],
  ['犯罪都市2', 2022, 1269],
  ['光海，成为王的男人', 2012, 1231],
  ['王的男人', 2005, 1230],
  ['与神同行2：因与缘', 2018, 1227],
  ['出租车司机', 2017, 1218],
  ['破墓', 2024, 1191],
  ['太极旗飘扬', 2004, 1174],
  ['釜山行', 2016, 1156],
  ['犯罪都市4', 2024, 1150],
  ['海云台', 2009, 1145],
  ['辩护人', 2013, 1137],
  ['实尾岛', 2003, 1108],
  ['犯罪都市3', 2023, 1068],
  ['寄生虫', 2019, 1031],
  ['检察官外传', 2016, 970],
  ['极限逃生', 2019, 942],
  ['雪国列车', 2013, 934],
  ['观相', 2013, 913],
  ['海盗', 2014, 866],
  ['奇怪的她', 2014, 865],
];

export const koreanBoxOfficeCollection: FilmCollection = {
  id: 'korean-box-office-top30',
  name: '韩国电影观影人次 TOP 30',
  intro: '合并 Naver 博主 nereid 的三篇榜单，按原文第 1–30 名排列；观影人次为原文约数，非实时票房榜。《实尾岛》的上映年份校正为 2003 年。',
  sources: [
    { name: '原文 1–10 名', url: 'https://blog.naver.com/nereid/224195411592' },
    { name: '原文 11–20 名', url: 'https://blog.naver.com/nereid/224190877908' },
    { name: '原文 21–30 名', url: 'https://blog.naver.com/nereid/224169927830' },
  ],
  sections: [{
    label: '韩国电影历代观影人次',
    films: rankedFilms.map(([title, year, admissions]) => [title, year, `原文观影人次 · ${admissions.toLocaleString('zh-CN')} 万`]),
  }],
};

export type MediaType = 'movie' | 'tv' | 'short' | 'animation' | 'variety' | 'documentary' | 'commentary' | 'unknown';

export const MEDIA_TYPE_LABELS: Record<MediaType, string> = {
  movie: '电影',
  tv: '电视剧',
  short: '短剧',
  animation: '动漫',
  variety: '综艺',
  documentary: '纪录片',
  commentary: '解说',
  unknown: '未分类',
};

/** 只根据片源分类判断，避免把「已完结」或「HD」误当成电影/电视剧依据。 */
export function classifyMediaType(typeName?: string): MediaType {
  const type = (typeName || '').trim().toLowerCase();
  if (!type) return 'unknown';
  if (/解说|解說|commentary/.test(type)) return 'commentary';
  if (/短剧|短劇|微剧|微劇|short.?drama/.test(type)) return 'short';
  if (/综艺|綜藝|variety/.test(type)) return 'variety';
  // 纪录片可能为单片或系列，保留片源类型，不强行归入电影。
  if (/纪录|记录片|紀錄|documentary/.test(type)) return 'documentary';
  if (/电影|電影|剧场版|劇場版|短片|\b(movie|film)\b/.test(type)) return 'movie';
  if (/动漫|動畫|动画|動漫|卡通|animation|anime|\b(ova|oad)\b/.test(type)) {
    return /动画片|動畫片/.test(type) ? 'movie' : 'animation';
  }
  if (/电视剧|電視劇|连续剧|連續劇|剧集|劇集|国产剧|國產劇|大陆剧|大陸劇|内地剧|內地劇|欧美剧|歐美劇|香港剧|香港劇|台湾剧|台灣劇|韩国剧|韓國劇|日本剧|日本劇|海外剧|海外劇|泰国剧|泰國劇|日剧|日劇|韩剧|韓劇|美剧|美劇|英剧|英劇|港剧|港劇|台剧|台劇|泰剧|泰劇|\btv\b|series|sitcom/.test(type)) return 'tv';
  if (/(?:剧情|劇情|喜剧|喜劇|动作|動作|爱情|愛情|科幻|恐怖|惊悚|驚悚|悬疑|懸疑|犯罪|战争|戰爭|冒险|冒險|武侠|武俠|奇幻|灾难|災難|伦理|倫理|其他|其它)片/.test(type)) return 'movie';
  return 'unknown';
}

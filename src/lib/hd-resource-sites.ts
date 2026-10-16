/** 用户指定资源站的适配注册表；界面和 API 只使用下方启用列表。 */
export const HD_RESOURCE_SITES = [
  { id: 'yinfans', name: '银盘', url: 'https://www.yinfans.me/', description: '蓝光原盘与高清版本' },
  { id: '1lou', name: '一楼', url: 'https://www.1lou.me/', description: '电影与剧集资源帖' },
  { id: 'rrdynb', name: '人人电影', url: 'https://www.rrdynb.com/', description: '电影、剧集与网盘资源' },
  { id: 'hdzu', name: 'HDzone', url: 'https://hdzu.org/', description: '高清资源目录' },
] as const;
// 银盘已关停、一楼服务器连接不可用，移除入口并停止请求；保留解析适配。
export const ACTIVE_HD_RESOURCE_SITES = HD_RESOURCE_SITES.filter(site => site.id === 'rrdynb' || site.id === 'hdzu');
export type HDResourceSiteId = (typeof HD_RESOURCE_SITES)[number]['id'];
export type HDResourceItem = { title: string; url: string; note: string };
export type HDResourceLink = { title: string; url: string; kind: '磁力' | '种子' | '网盘' | '文件' };
export type HDResourceCatalog = { items: HDResourceItem[]; next?: string; fetchedAt: string };
export type HDResourceDetail = { title: string; url: string; summary: string; resources: HDResourceLink[]; loginRequired: boolean; fetchedAt: string };
export function hdResourceSite(id: string | null) {
  return HD_RESOURCE_SITES.find(site => site.id === id);
}

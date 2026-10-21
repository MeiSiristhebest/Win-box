/** 搜索窗口的路由及固定身份（身份在渲染入口首次加载时捕获）。 */
export function searchWindowRoute(term: string, profileId?: string, allProfiles = true): string {
  const query = new URLSearchParams({ agg: String(term).trim(), sw: '1' });
  if (profileId) query.set('profileId', profileId);
  query.set('profiles', allProfiles ? 'all' : 'current');
  return `/search?${query.toString().replace(/\+/g, '%20')}`;
}

export function isSearchWinHash(hash: string): boolean {
  return /[?&]sw=1(?:&|$)/.test(String(hash || ''));
}

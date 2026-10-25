import type { ParseBean, SiteConfig } from '../../shared/types';

export const PROFILE_SNAPSHOT_VERSION = 2;

/** Remove malformed and synthetic parser entries before persisting a profile snapshot. */
export function realParses(parses: ParseBean[] | undefined): ParseBean[] {
  return (parses || [])
    .filter((parse) => parse && parse.name && parse.url && parse.type !== 4)
    .map((parse) => ({ name: parse.name, url: parse.url, ext: parse.ext || '', type: parse.type }));
}

/** Serialize the versioned, restorable part of a subscription profile. */
export function serializeImport(parsed: SiteConfig): string {
  return JSON.stringify({
    version: PROFILE_SNAPSHOT_VERSION,
    spider: parsed.spider || '',
    flags: Array.isArray(parsed.flags) ? [...parsed.flags] : [],
    jarCache: typeof parsed.jarCache === 'string' ? parsed.jarCache : '',
    danmaku: typeof parsed.danmaku === 'string' ? parsed.danmaku : '',
    wallpaper: typeof parsed.wallpaper === 'string' ? parsed.wallpaper : '',
    hosts: parsed.hosts && typeof parsed.hosts === 'object' ? { ...parsed.hosts } : {},
    rules: Array.isArray(parsed.rules) ? parsed.rules.map((rule) => ({ ...rule })) : [],
    doh: Array.isArray(parsed.doh) ? [...parsed.doh] : [],
    ads: Array.isArray(parsed.ads) ? [...parsed.ads] : [],
    proxy: Array.isArray(parsed.proxy) ? parsed.proxy.map((rule) => ({ ...rule })) : [],
    sites: Array.isArray(parsed.sites) ? parsed.sites.map((site) => ({
      ...site,
      categories: site.categories ? [...site.categories] : site.categories,
    })) : [],
    lives: Array.isArray(parsed.lives) ? parsed.lives.map((live) => ({
      ...live,
      header: live.header ? { ...live.header } : live.header,
    })) : [],
    parses: realParses(parsed.parses),
  });
}

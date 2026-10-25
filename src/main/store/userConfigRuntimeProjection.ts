import type { SiteConfig, SourceBean, UserConfig } from '../../shared/types';

/** Build the execution-facing configuration from the persisted user profile. */
export function projectUserConfigToSiteConfig(snapshot: UserConfig): SiteConfig {
  const baseUrl = snapshot.apiUrl || '';
  return {
    sites: (baseUrl ? snapshot.sources.map((source) => normalizeSourcePaths(source, baseUrl)) : snapshot.sources)
      .filter((source) => !snapshot.globallyBlockedSourceKeys?.includes(source.key)),
    parses: snapshot.parses || [],
    lives: snapshot.lives,
    flags: snapshot.global.flags,
    spider: baseUrl ? resolveRelativeValue(snapshot.global.spider, baseUrl) : snapshot.global.spider,
    jarCache: 'true',
    danmaku: '',
    wallpaper: '',
    hosts: {},
    rules: [],
    doh: [],
    ads: [],
    proxy: [],
  };
}

export function normalizeSourcePaths(source: SourceBean, baseUrl: string): SourceBean {
  const jar = resolveRelativeValue(source.jar || '', baseUrl);
  const api = resolveRelativeValue(source.api || '', baseUrl);
  if (jar === source.jar && api === source.api) return source;
  return { ...source, jar, api };
}

/** Resolve ./x and ../x values while preserving optional jar checksum suffixes. */
export function resolveRelativeValue(value: string, baseUrl: string): string {
  const trimmed = (value || '').trim();
  if (!trimmed || !/^\.\.?\//.test(trimmed)) return value;
  if (!/^https?:\/\//i.test(baseUrl)) return value;
  const directory = baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1);
  if (!directory) return value;

  const [head, ...suffix] = trimmed.split(';');
  let resolved: string;
  try {
    resolved = new URL(head, directory).toString();
  } catch {
    resolved = head.startsWith('../')
      ? directory.replace(/[^/]+\/$/, '')
      : directory + head.replace(/^\.\//, '');
  }
  return [resolved, ...suffix].join(';');
}

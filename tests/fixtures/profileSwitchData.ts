import type { LiveGroup, UserConfig, UserProfile } from '../../src/shared/types';
import { parseSiteConfig } from '../../src/engine/config/ApiConfigParser';

export function profileConfig(id: string, sites = true, lives = true): UserConfig {
  const json = JSON.stringify({ sites: sites ? [{ key: 'same-key', name: id + '站点', type: 1, api: 'https://example.test/' + id }] : [], lives: lives ? [{ name: id + '直播', url: 'https://example.test/' + id + '.m3u' }] : [] });
  const parsed = parseSiteConfig(json).config;
  const profile: UserProfile = { id, name: id + '子仓', apiUrl: 'https://example.test/' + id + '.json', json, sourceCount: parsed.sites.length, importedAt: '2026-10-18T00:00:00.000Z' };
  return { version: 3, apiUrl: profile.apiUrl, global: { spider: parsed.spider, flags: parsed.flags }, sources: parsed.sites, lives: parsed.lives, parses: parsed.parses, ui: { activeSourceKey: parsed.sites[0]?.key ?? '', activeLiveIndex: 0 }, profiles: [profile], activeProfileId: id, subscriptionGroups: [], deletedSourceKeys: [] };
}

export function liveResult(id: string): { groups: LiveGroup[]; liveName: string } {
  return { liveName: id + '直播', groups: [{ group: id + '分组', channels: [{ name: id + '频道', urls: ['https://example.test/' + id + '.m3u8'], logo: '', epg: '', ua: '', click: '', format: '', origin: '', referer: '', 'tvg-id': '', 'tvg-name': '', 'tvg-chno': '' }] }] };
}

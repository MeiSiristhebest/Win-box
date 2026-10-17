import { describe, expect, it } from 'vitest';
import { parseSiteConfig } from '../src/engine/config/ApiConfigParser';
import { PROFILE_SNAPSHOT_VERSION, serializeImport } from '../src/main/store/UserConfigManager';

describe('profile snapshots', () => {
  it('round-trips every supported subscription-level field', () => {
    const parsed = parseSiteConfig(JSON.stringify({
      sites: [{ key: 'source-a', name: 'Source A', type: 0, api: 'https://example.test/api' }],
      lives: [{ name: 'Live A', type: '0', url: 'https://example.test/live.m3u', api: '', jar: '', ext: '', epg: '', playerType: '', timeout: 15 }],
      parses: [{ name: 'Parse A', url: 'https://example.test/parse', type: 1, ext: '' }],
      spider: 'https://example.test/spider.jar',
      flags: ['vip-a'],
      jarCache: false,
      danmaku: 'https://example.test/danmaku',
      wallpaper: 'https://example.test/wallpaper',
      hosts: { 'example.test': '127.0.0.1' },
      rules: [{ host: 'example.test', rule: ['.ad'] }],
      doh: ['https://dns.example.test/query'],
      ads: ['https://example.test/ad.js'],
      proxy: [{ name: 'proxy-a', type: 0, server: 'https://proxy.example.test' }],
    })).config;

    const stored = JSON.parse(serializeImport(parsed)) as Record<string, unknown>;
    expect(stored.version).toBe(PROFILE_SNAPSHOT_VERSION);
    const restored = parseSiteConfig(JSON.stringify(stored)).config;
    expect(restored).toMatchObject({
      sites: parsed.sites,
      lives: parsed.lives,
      spider: parsed.spider,
      flags: parsed.flags,
      jarCache: parsed.jarCache,
      danmaku: parsed.danmaku,
      wallpaper: parsed.wallpaper,
      hosts: parsed.hosts,
      rules: parsed.rules,
      doh: parsed.doh,
      ads: parsed.ads,
      proxy: parsed.proxy,
    });
    expect(restored.parses.filter((item) => item.type !== 4)).toEqual(parsed.parses.filter((item) => item.type !== 4));
  });
});

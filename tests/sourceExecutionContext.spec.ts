import { describe, expect, it } from 'vitest';
import { SourceExecutionContext } from '../src/main/spider/SourceExecutionContext';
import type { SiteConfig, SourceBean } from '../src/shared/types';

function config(source: SourceBean): SiteConfig {
  return {
    sites: [source],
    parses: [],
    lives: [],
    flags: [],
    spider: '',
    jarCache: '',
    danmaku: '',
    wallpaper: '',
    hosts: {},
    rules: [],
    doh: [],
    ads: [],
    proxy: [],
  };
}

describe('SourceExecutionContext', () => {
  it('resolves an active source from the current configuration on each request', () => {
    const first = { key: 'source', name: 'First', api: 'https://first.test/api' } as SourceBean;
    const second = { key: 'source', name: 'Second', api: 'https://second.test/api' } as SourceBean;
    let active = config(first);
    const context = new SourceExecutionContext({
      activeProfileId: () => 'profile-a',
      activeConfig: () => active,
      findProfile: () => null,
      profileConfig: () => null,
      activeSource: (key) => active.sites.find((source) => source.key === key) ?? null,
    });

    expect(context.forRequest('source')?.name).toBe('First');
    active = config(second);
    expect(context.forRequest('source')?.name).toBe('Second');
    expect(context.forRequest('missing')).toBeNull();
  });

  it('adds profile identity without mutating the configured source', () => {
    const source = { key: 'source', name: 'Source', api: 'https://source.test/api' } as SourceBean;
    const active = config(source);
    const context = new SourceExecutionContext({
      activeProfileId: () => 'profile-a',
      activeConfig: () => active,
      findProfile: () => null,
      profileConfig: () => null,
      activeSource: (key) => active.sites.find((item) => item.key === key) ?? null,
    });

    const resolved = context.forRequest('source');

    expect(resolved).toMatchObject({ key: 'source', runtimeScope: JSON.stringify(['profile-a', 'source']) });
    expect(source.runtimeScope).toBeUndefined();
  });
});

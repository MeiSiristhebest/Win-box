import { describe, expect, it, vi } from 'vitest';
import type { AuditItem, SourceBean } from '../src/shared/types';
import { sourceConfigurationSignature } from '../src/shared/sourceConfigurationSignature';
import { removeFailedSources, type SourceHealthAuditPort } from '../src/renderer/features/settings/application/sourceHealthAudit';

function source(key: string): SourceBean {
  return {
    key,
    name: `Source ${key}`,
    type: 0,
    api: `https://${key}.example/api.php/provide/vod`,
    searchable: 1,
    quickSearch: 1,
    changeable: 1,
    filterable: 1,
    playUrl: '',
    ext: '',
    jar: '',
    playerType: -1,
    categories: null,
    timeout: 15,
    click: '',
    style: '',
  };
}

function failedAudit(item: SourceBean): AuditItem {
  return {
    key: item.key,
    name: item.name,
    type: item.type,
    kind: 'cms-json',
    items: 0,
    classes: 0,
    extEmpty: true,
    ms: 0,
    health: 'error',
    usable: false,
    needsExt: false,
    advice: 'request-failed',
  };
}

describe('source health cleanup application', () => {
  it('deletes more than one IPC batch while advancing the expected source signature', async () => {
    let currentSources = Array.from({ length: 1001 }, (_, index) => source(`source-${index}`));
    const deleteSources = vi.fn<SourceHealthAuditPort['deleteSources']>(async (keys, _profileId, expectedSignature) => {
      expect(expectedSignature).toBe(sourceConfigurationSignature(currentSources));
      const requested = new Set(keys);
      currentSources = currentSources.filter((item) => !requested.has(item.key));
      return [...requested];
    });
    const port: SourceHealthAuditPort = {
      run: vi.fn(async () => []),
      deleteSources,
      announceSourcesChanged: vi.fn(),
    };

    const result = await removeFailedSources(currentSources.map(failedAudit), currentSources, 'profile-a', port);

    expect(result).toEqual({ kind: 'all-removed', deletedCount: 1001 });
    expect(port.deleteSources).toHaveBeenCalledTimes(2);
    expect(deleteSources.mock.calls.map(([keys]) => keys.length)).toEqual([1000, 1]);
    expect(currentSources).toEqual([]);
  });

  it('includes mutable source settings in the stale-audit signature', () => {
    const base = source('source-a');
    const variants: SourceBean[] = [
      { ...base, key: 'source-b' },
      { ...base, runtimeScope: 'profile-b' },
      { ...base, name: 'Renamed' },
      { ...base, type: 1 },
      { ...base, api: 'https://other.example/api.php/provide/vod' },
      { ...base, searchable: 0 },
      { ...base, quickSearch: 0 },
      { ...base, changeable: 0 },
      { ...base, filterable: 0 },
      { ...base, playUrl: 'https://other.example/play/' },
      { ...base, ext: '{"token":"changed"}' },
      { ...base, jar: 'https://example.test/updated.jar' },
      { ...base, playerType: 1 },
      { ...base, categories: ['movies'] },
      { ...base, timeout: 30 },
      { ...base, click: 'other.example;.play' },
      { ...base, style: 'updated-style' },
      { ...base, homePage: 'https://example.test/home.html' },
    ];

    for (const changed of variants) {
      expect(sourceConfigurationSignature([base])).not.toBe(sourceConfigurationSignature([changed]));
    }
    const reversedProperties = Object.fromEntries(Object.entries(base).reverse()) as SourceBean;
    expect(sourceConfigurationSignature([base])).toBe(sourceConfigurationSignature([reversedProperties]));
  });

  it('stops cleanup when the source list changes before a later batch', async () => {
    const sources = Array.from({ length: 1001 }, (_, index) => source(`source-${index}`));
    let call = 0;
    const port: SourceHealthAuditPort = {
      run: vi.fn(async () => []),
      deleteSources: vi.fn(async (keys) => {
        call += 1;
        if (call === 1) return keys;
        throw new Error('线路列表已变化，请重新体检后再清理线路');
      }),
      announceSourcesChanged: vi.fn(),
    };

    await expect(removeFailedSources(sources.map(failedAudit), sources, 'profile-a', port))
      .rejects.toThrow('已删除 1000 个请求失败线路；后续清理已中止');
    expect(port.deleteSources).toHaveBeenCalledTimes(2);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { findHistorySource, resolveHistorySource } from '../src/renderer/lib/historySource';
import type { ProfileSitesView } from '../src/shared/types';

const view: ProfileSitesView = {
  activeId: 'sub-b',
  profiles: [
    { id: 'sub-a', name: '订阅 A', sites: [{ key: 'source-a', name: '源 A' }] },
    { id: 'sub-b', name: '订阅 B', sites: [{ key: 'source-b', name: '源 B' }] },
  ],
};

describe('findHistorySource — 历史跨订阅恢复', () => {
  it('优先按保存的 profileId 找到原订阅和源', () => {
    expect(findHistorySource(view, { profileId: 'sub-a', sourceKey: 'source-a', sourceName: '源 A' })).toEqual({
      profileId: 'sub-a', profileName: '订阅 A', key: 'source-a', name: '源 A',
    });
  });

  it('旧历史没有 profileId 时按 sourceKey + sourceName 反查', () => {
    expect(findHistorySource(view, { sourceKey: 'source-a', sourceName: '源 A' })?.profileId).toBe('sub-a');
  });

  it('兼容旧历史把 sourceName 写成影片名：唯一 sourceKey 仍能定位', () => {
    expect(findHistorySource(view, { sourceKey: 'source-a', sourceName: '某部影片' })?.profileId).toBe('sub-a');
  });

  it('相同 key 在多个订阅存在时，sourceName 可消除歧义', () => {
    const duplicated: ProfileSitesView = {
      activeId: 'sub-b',
      profiles: [
        { id: 'sub-a', name: '订阅 A', sites: [{ key: 'same', name: '旧源名' }] },
        { id: 'sub-b', name: '订阅 B', sites: [{ key: 'same', name: '当前源名' }] },
      ],
    };
    expect(findHistorySource(duplicated, { sourceKey: 'same', sourceName: '旧源名' })?.profileId).toBe('sub-a');
  });

  it('找不到来源时返回 null，不把历史交给错误订阅解析', () => {
    expect(findHistorySource(view, { sourceKey: 'missing', sourceName: '不存在' })).toBeNull();
  });

  it('解析历史来源时读取所属档案，但不切换全局活动订阅', async () => {
    const cfgGet = vi.fn(async () => ({ activeProfileId: 'sub-b', sources: view.profiles[1].sites }));
    const cfgProfileSites = vi.fn(async () => structuredClone(view));
    const source = await resolveHistorySource({ cfgGet, cfgProfileSites }, { profileId: 'sub-a', sourceKey: 'source-a' });

    expect(source).toMatchObject({ profileId: 'sub-a', key: 'source-a', name: '源 A' });
    expect(cfgGet).toHaveBeenCalledOnce();
    expect(cfgProfileSites).toHaveBeenCalledOnce();
  });
});

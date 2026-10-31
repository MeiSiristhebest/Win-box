import { describe, expect, it } from 'vitest';
import type { ProfileSitesView, SourceBean } from '../src/shared/types';
import { presentSourcePicker } from '../src/renderer/features/subscriptions/application/sourcePickerPresentation';

const source = (key: string, name: string): SourceBean => ({ key, name } as SourceBean);

describe('source picker presentation', () => {
  const profiles: ProfileSitesView = {
    activeId: 'profile-a',
    profiles: [
      { id: 'profile-a', name: '当前档案', sites: [{ key: 'a-main', name: '主线路' }] },
      { id: 'profile-b', name: '其他档案', sites: [{ key: 'b-alt', name: '备用线路' }] },
    ],
  };

  it('projects the selected profile, current profile, query and source options independently', () => {
    const result = presentSourcePicker({
      sources: [source('a-main', '主线路')],
      activeSourceKey: 'a-main',
      profileSites: profiles,
      selectedProfileId: 'profile-b',
      query: ' ALT ',
    });

    expect(result.label).toBe('主线路');
    expect(result.hasMultipleProfiles).toBe(true);
    expect(result.selectedProfile?.id).toBe('profile-b');
    expect(result.activeProfileId).toBe('profile-a');
    expect(result.paneIsActive).toBe(false);
    expect(result.sourceOptions.map(item => item.key)).toEqual(['b-alt']);
    expect(result.filteredSources.map(item => item.key)).toEqual(['b-alt']);
    expect(result.tip).toContain('2 份订阅');
  });

  it('falls back to the active profile when the selected profile is stale', () => {
    const result = presentSourcePicker({
      sources: [source('a-main', '主线路')],
      activeSourceKey: 'a-main',
      profileSites: profiles,
      selectedProfileId: 'removed-profile',
      query: '',
    });

    expect(result.selectedProfile?.id).toBe('profile-a');
    expect(result.paneIsActive).toBe(true);
    expect(result.filteredSources.map(item => item.key)).toEqual(['a-main']);
  });

  it('uses the current sources while profile data is unavailable', () => {
    const result = presentSourcePicker({
      sources: [source('a-main', '主线路')],
      activeSourceKey: 'a-main',
      profileSites: null,
      selectedProfileId: '',
      query: 'a-main',
    });

    expect(result.label).toBe('主线路');
    expect(result.paneIsActive).toBe(true);
    expect(result.filteredSources).toEqual([{ key: 'a-main', name: '主线路' }]);
    expect(result.tip).toBe('正在加载订阅…');
  });

  it('explains the difference between an empty but valid profile and an unreadable saved profile', () => {
    const profileSites: ProfileSitesView = {
      activeId: 'empty',
      profiles: [
        { id: 'empty', name: '空子仓', sites: [], restorable: true },
        { id: 'broken', name: '损坏子仓', sites: [], restorable: false, unavailableReason: '保存的配置快照无法解析' },
      ],
    };

    const empty = presentSourcePicker({
      sources: [], activeSourceKey: '', profileSites, selectedProfileId: 'empty', query: '',
    });
    expect(empty.emptyMessage).toBe('该子仓暂无点播源；直播线路不显示在这里');
    expect(empty.tip).toContain('0 个点播源');

    const broken = presentSourcePicker({
      sources: [], activeSourceKey: '', profileSites, selectedProfileId: 'broken', query: '',
    });
    expect(broken.emptyMessage).toBe('保存的配置快照无法解析');
    expect(broken.selectedProfile?.restorable).toBe(false);
    expect(broken.tip).toContain('点子仓名称立即切换 · 点眼睛仅预览');
  });

  it('explains an empty active profile even when there is no second profile column', () => {
    const result = presentSourcePicker({
      sources: [],
      activeSourceKey: '',
      profileSites: { activeId: 'only', profiles: [{ id: 'only', name: '单一子仓', sites: [], restorable: true }] },
      selectedProfileId: 'only',
      query: '',
    });

    expect(result.hasMultipleProfiles).toBe(false);
    expect(result.emptyMessage).toBe('该子仓暂无点播源；直播线路不显示在这里');
  });
});

import type { ProfileSitesView, SourceBean } from '../../../../shared/types';

export interface SourcePickerPresentationInput {
  sources: SourceBean[];
  controlledSources?: boolean;
  activeSourceKey: string;
  profileSites: ProfileSitesView | null;
  selectedProfileId: string;
  query: string;
}

export function presentSourcePicker(input: SourcePickerPresentationInput) {
  const profiles = input.profileSites?.profiles ?? [];
  const hasMultipleProfiles = profiles.length > 1;
  const selectedProfile = profiles.length === 1
    ? profiles[0]
    : profiles.find(profile => profile.id === input.selectedProfileId)
      ?? profiles.find(profile => profile.id === input.profileSites?.activeId);
  const sourceOptions = selectedProfile
    ? selectedProfile.id === input.profileSites?.activeId
      ? input.controlledSources
        ? input.sources.map(source => ({ key: source.key, name: source.name || source.key }))
        : selectedProfile.sites
      : selectedProfile.sites
    : input.sources.map(source => ({ key: source.key, name: source.name || source.key }));
  const normalizedQuery = input.query.trim().toLowerCase();
  const filteredSources = normalizedQuery
    ? sourceOptions.filter(source =>
      (source.name || source.key).toLowerCase().includes(normalizedQuery)
      || source.key.toLowerCase().includes(normalizedQuery))
    : sourceOptions;
  const currentSource = input.sources.find(source => source.key === input.activeSourceKey);
  const sourceCount = normalizedQuery
    ? `${filteredSources.length}/${sourceOptions.length} 个点播源`
    : `${sourceOptions.length} 个点播源`;
  const label = currentSource
    ? currentSource.name || currentSource.key
    : input.sources[0]
      ? input.sources[0].name || input.sources[0].key
      : '未导入源';

  return {
    label,
    profiles,
    selectedProfile,
    hasMultipleProfiles,
    activeProfileId: input.profileSites?.activeId ?? '',
    paneIsActive: !selectedProfile || selectedProfile.id === input.profileSites?.activeId,
    sourceOptions,
    filteredSources,
    emptyMessage: selectedProfile?.restorable === false
      ? selectedProfile.unavailableReason || '该子仓没有可恢复的配置快照'
      : sourceOptions.length === 0
        ? selectedProfile ? '该子仓暂无点播源；直播线路不显示在这里' : '未导入源'
        : '没有匹配的来源',
    tip: input.profileSites
      ? `${hasMultipleProfiles ? '点子仓名称立即切换 · 点眼睛仅预览' : '选择来源'} · ${sourceCount}${hasMultipleProfiles ? ` · ${profiles.length} 份订阅` : ''}`
      : '正在加载订阅…',
  };
}

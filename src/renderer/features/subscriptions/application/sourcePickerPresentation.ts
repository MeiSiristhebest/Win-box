import type { ProfileSitesView, SourceBean } from '../../../../shared/types';

export interface SourcePickerPresentationInput {
  sources: SourceBean[];
  activeSourceKey: string;
  profileSites: ProfileSitesView | null;
  selectedProfileId: string;
  query: string;
}

export function presentSourcePicker(input: SourcePickerPresentationInput) {
  const profiles = input.profileSites?.profiles ?? [];
  const hasMultipleProfiles = profiles.length > 1;
  const selectedProfile = hasMultipleProfiles
    ? profiles.find(profile => profile.id === input.selectedProfileId)
      ?? profiles.find(profile => profile.id === input.profileSites?.activeId)
    : undefined;
  const sourceOptions = selectedProfile
    ? selectedProfile.sites
    : input.sources.map(source => ({ key: source.key, name: source.name || source.key }));
  const normalizedQuery = input.query.trim().toLowerCase();
  const filteredSources = normalizedQuery
    ? sourceOptions.filter(source =>
      (source.name || source.key).toLowerCase().includes(normalizedQuery)
      || source.key.toLowerCase().includes(normalizedQuery))
    : sourceOptions;
  const currentSource = input.sources.find(source => source.key === input.activeSourceKey);
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
    emptyMessage: sourceOptions.length === 0 ? '（未导入源）' : '（无匹配源）',
    tip: input.profileSites
      ? `点击源名切换 · 共 ${filteredSources.length} 个${hasMultipleProfiles ? ` · ${profiles.length} 份订阅` : ''}`
      : '正在加载订阅…',
  };
}

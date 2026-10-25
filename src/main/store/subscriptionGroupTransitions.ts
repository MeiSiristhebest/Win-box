import { parseSiteConfig } from '../../engine/config/ApiConfigParser';
import type { SiteConfig, SubscriptionGroup, UserConfig, UserProfile } from '../../shared/types';
import { filterDeletedProfileSources, sourceDeletionKeys, withSourceDeletionKeys } from './sourceDeletionScopes';
import { clampIndex } from './userConfigNormalization';
import { mergeLocalLives } from './userConfigProfileState';
import { realParses } from './userProfileSnapshot';

/** Commit the acquired members as one state transition, preserving unsuccessful members. */
export function commitSubscriptionGroupInConfig(
  config: UserConfig,
  group: SubscriptionGroup,
  importedProfiles: readonly UserProfile[],
  activateProfileId?: string,
  restoreDeletedSources = false,
): { config: UserConfig; filteredSourceKeys: string[] } {
  if (!group.id || !group.url || !Array.isArray(group.members)) throw new Error('多仓订阅组数据无效');
  const profilesById = new Map(config.profiles.map((profile) => [profile.id, profile]));
  for (const profile of importedProfiles) {
    if (!profile.id || !profile.json || profile.groupId !== group.id) continue;
    profilesById.set(profile.id, { ...profile });
  }
  const profiles = [...profilesById.values()];
  let deletionState = config;
  if (restoreDeletedSources) {
    for (const profile of importedProfiles) {
      if (!profile.id || !profile.json || profile.groupId !== group.id) continue;
      const restoredKeys = new Set(parseSiteConfig(profile.json).config.sites.map((source) => source.key));
      deletionState = withSourceDeletionKeys(deletionState, sourceDeletionKeys(deletionState, profile.id).filter((key) => !restoredKeys.has(key)), profile.id);
    }
  }
  let next: UserConfig = {
    ...config,
    profiles,
    deletedSourceKeysByProfile: deletionState.deletedSourceKeysByProfile,
    subscriptionGroups: [
      ...config.subscriptionGroups.filter((existing) => existing.id !== group.id),
      { ...group, members: group.members.map((member) => ({ ...member })) },
    ],
  };
  let filteredSourceKeys: string[] = [];
  if (activateProfileId) {
    const profile = profiles.find((candidate) => candidate.id === activateProfileId);
    if (!profile) throw new Error(`待切换的子档案不存在：${activateProfileId}`);
    let parsed: SiteConfig;
    try {
      parsed = parseSiteConfig(profile.json).config;
    } catch (error) {
      throw new Error(`子档案「${profile.name}」快照无法恢复：${(error as Error).message}`);
    }
    const filtered = filterDeletedProfileSources(next, parsed.sites.map((source) => ({ ...source })), profile.id);
    filteredSourceKeys = filtered.filteredSourceKeys;
    next = mergeLocalLives({
      ...next,
      activeProfileId: profile.id,
      apiUrl: profile.apiUrl,
      global: { spider: parsed.spider || '', flags: [...(parsed.flags || [])] },
      sources: filtered.sources,
      lives: parsed.lives.map((live) => ({ ...live, header: live.header ? { ...live.header } : undefined })),
      parses: realParses(parsed.parses),
      ui: {
        ...config.ui,
        activeSourceKey: filtered.sources.some((source) => source.key === config.ui.activeSourceKey) ? config.ui.activeSourceKey : '',
      },
    }, config.lives);
    next = { ...next, ui: { ...next.ui, activeLiveIndex: clampIndex(next.ui.activeLiveIndex, next.lives.length) } };
  }
  return { config: next, filteredSourceKeys };
}

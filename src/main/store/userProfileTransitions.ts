import { parseSiteConfig } from '../../engine/config/ApiConfigParser';
import { isLocalLiveUrl } from '../../engine/live/localLive';
import type {
  SiteConfig,
  SubscriptionRefreshResolution,
  UserConfig,
  UserProfile,
} from '../../shared/types';
import {
  applySubscriptionSourceOverrides,
  deriveSubscriptionSourceOverrides,
  serializeSubscriptionSourceOverrides,
} from './subscriptionProfileMerge';
import { realParses, serializeImport } from './userProfileSnapshot';
import { clampIndex } from './userConfigNormalization';
import { filterDeletedProfileSources, sourceDeletionKeys } from './sourceDeletionScopes';
import { mergeLocalLives } from './userConfigProfileState';

export interface UserProfileTransitionResult {
  config: UserConfig;
  filteredSourceKeys: string[];
}

/** Restore a saved profile and its selected source without mutating the current snapshot. */
export function activateProfileInConfig(config: UserConfig, id: string, pickKey = ''): UserProfileTransitionResult {
  const profile = config.profiles.find((item) => item.id === id);
  if (!profile) throw new Error(`档案不存在：${id}`);
  if (!profile.json) throw new Error(`档案「${profile.name}」没有可恢复的内容（json 为空）`);
  let parsed: SiteConfig;
  try {
    parsed = parseSiteConfig(profile.json).config;
  } catch (error) {
    throw new Error(`档案「${profile.name}」JSON 解析失败：${(error as Error).message}`);
  }
  const filtered = filterDeletedProfileSources(config, parsed.sites.map((source) => ({ ...source })), id);
  const activeSourceKey = pickKey && filtered.sources.some((source) => source.key === pickKey) ? pickKey
    : filtered.sources.some((source) => source.key === config.ui.activeSourceKey) ? config.ui.activeSourceKey : '';
  const next = mergeLocalLives({
    ...config,
    activeProfileId: id,
    apiUrl: profile.apiUrl || config.apiUrl,
    global: { spider: parsed.spider || '', flags: Array.isArray(parsed.flags) ? [...parsed.flags] : [] },
    sources: filtered.sources,
    lives: parsed.lives.map((live) => ({ ...live, header: live.header ? { ...live.header } : undefined })),
    parses: realParses(parsed.parses),
    ui: { ...config.ui, activeSourceKey },
  }, config.lives);
  return {
    config: { ...next, ui: { ...next.ui, activeLiveIndex: clampIndex(next.ui.activeLiveIndex, next.lives.length) } },
    filteredSourceKeys: filtered.filteredSourceKeys,
  };
}

/** Delete a profile and restore the next profile's runtime state when needed. */
export function deleteProfileFromConfig(config: UserConfig, id: string): UserProfileTransitionResult | null {
  if (!config.profiles.some((profile) => profile.id === id)) return null;
  const profiles = config.profiles.filter((profile) => profile.id !== id);
  const subscriptionGroups = removeProfileFromSubscriptionGroups(config, id);

  if (id !== config.activeProfileId) {
    return { config: { ...config, profiles, subscriptionGroups }, filteredSourceKeys: [] };
  }

  const localLives = config.lives.filter((live) => isLocalLiveUrl(live.url));
  const nextProfile = profiles[0];
  if (!nextProfile) {
    return {
      config: {
        ...config,
        profiles: [],
        subscriptionGroups,
        activeProfileId: '',
        apiUrl: '',
        global: { spider: '', flags: [] },
        sources: [],
        lives: localLives,
        parses: [],
        ui: { ...config.ui, activeSourceKey: '', activeLiveIndex: clampIndex(config.ui.activeLiveIndex, localLives.length) },
      },
      filteredSourceKeys: [],
    };
  }

  let parsed: SiteConfig | null = null;
  if (nextProfile.json) {
    try {
      parsed = parseSiteConfig(nextProfile.json).config;
    } catch {
      parsed = null;
    }
  }
  if (!parsed) {
    return {
      config: {
        ...config,
        profiles,
        subscriptionGroups,
        activeProfileId: nextProfile.id,
        apiUrl: '',
        global: { spider: '', flags: [] },
        sources: [],
        lives: localLives,
        parses: [],
        ui: { ...config.ui, activeSourceKey: '', activeLiveIndex: clampIndex(config.ui.activeLiveIndex, localLives.length) },
      },
      filteredSourceKeys: [],
    };
  }

  const deletedKeys = new Set(sourceDeletionKeys(config, nextProfile.id));
  const filteredSourceKeys: string[] = [];
  const sources = parsed.sites.flatMap((source) => {
    if (!deletedKeys.has(source.key)) return [{ ...source }];
    filteredSourceKeys.push(source.key);
    return [];
  });
  let next = mergeLocalLives({
    ...config,
    profiles,
    subscriptionGroups,
    activeProfileId: nextProfile.id,
    apiUrl: nextProfile.apiUrl || '',
    global: { spider: parsed.spider || '', flags: Array.isArray(parsed.flags) ? [...parsed.flags] : [] },
    sources,
    lives: parsed.lives.map((live) => ({ ...live })),
    parses: realParses(parsed.parses),
  }, config.lives);
  if (!next.sources.some((source) => source.key === next.ui.activeSourceKey)) {
    next = { ...next, ui: { ...next.ui, activeSourceKey: '' } };
  }
  next = { ...next, ui: { ...next.ui, activeLiveIndex: clampIndex(next.ui.activeLiveIndex, next.lives.length) } };
  return { config: next, filteredSourceKeys };
}

/** Rename a profile and keep its subscription-group display name in sync. */
export function renameProfileInConfig(config: UserConfig, id: string, name: string): UserConfig {
  const normalizedName = (name || '').trim();
  if (!normalizedName) return config;

  return {
    ...config,
    profiles: config.profiles.map((profile) => profile.id === id
      ? { ...profile, name: normalizedName }
      : profile),
    subscriptionGroups: config.subscriptionGroups.map((group) => ({
      ...group,
      members: group.members.map((member) => member.profileId === id
        ? { ...member, name: normalizedName }
        : member),
    })),
  };
}

/** Detach a profile from any group when its saved profile is deleted. */
export function removeProfileFromSubscriptionGroups(config: UserConfig, id: string): UserConfig['subscriptionGroups'] {
  return config.subscriptionGroups
    .map((group) => {
      const members = group.members.filter((member) => member.profileId !== id);
      return { ...group, members, status: subscriptionGroupStatus(members) };
    })
    .filter((group) => group.members.length > 0);
}

/** Remove an upstream-removed member while preserving its profile as a standalone profile. */
export function removeSubscriptionGroupMemberFromConfig(
  config: UserConfig,
  groupId: string,
  memberId: string,
  updatedAt: string,
): UserConfig {
  const group = config.subscriptionGroups.find((item) => item.id === groupId);
  if (!group) throw new Error('订阅组不存在');
  if (!group.members.some((item) => item.id === memberId)) throw new Error('订阅组成员不存在');

  const members = group.members.filter((item) => item.id !== memberId);
  return {
    ...config,
    profiles: config.profiles.map((profile) => profile.groupId === groupId && profile.memberId === memberId
      ? { ...profile, groupId: undefined, memberId: undefined }
      : profile),
    subscriptionGroups: config.subscriptionGroups.map((item) => item.id !== groupId ? item : {
      ...item,
      members,
      status: subscriptionGroupStatus(members),
      updatedAt,
    }),
  };
}

/**
 * Resolve a legacy profile's first-refresh diff without performing persistence or runtime I/O.
 * The caller supplies the timestamp so this transition remains deterministic and testable.
 */
export function resolveSubscriptionGroupMemberRefreshInConfig(
  config: UserConfig,
  groupId: string,
  memberId: string,
  resolution: SubscriptionRefreshResolution,
  now: string,
): UserConfig {
  const group = config.subscriptionGroups.find((item) => item.id === groupId);
  if (!group) throw new Error('订阅组不存在');
  const member = group.members.find((item) => item.id === memberId);
  if (!member) throw new Error('订阅组成员不存在');
  if (!member.profileId) throw new Error('子仓档案不存在，无法处理首次刷新差异');
  const profile = config.profiles.find((item) => item.id === member.profileId);
  if (!profile) throw new Error('子仓档案不存在，无法处理首次刷新差异');
  if (!profile.pendingUpstreamJson) throw new Error('该子仓没有待处理的首次刷新差异');

  let upstream: SiteConfig;
  let current: SiteConfig;
  try {
    upstream = parseSiteConfig(profile.pendingUpstreamJson).config;
    current = parseSiteConfig(profile.json).config;
  } catch (error) {
    throw new Error(`子仓快照无法解析：${(error as Error).message}`);
  }

  const overrides = resolution === 'keep-current'
    ? deriveSubscriptionSourceOverrides(upstream.sites, current.sites)
    : deriveSubscriptionSourceOverrides(upstream.sites, upstream.sites);
  const effective = {
    ...upstream,
    sites: applySubscriptionSourceOverrides(upstream.sites, overrides),
  };

  const profileWithoutCandidate: UserProfile = { ...profile };
  delete profileWithoutCandidate.pendingUpstreamJson;
  const updatedProfile: UserProfile = {
    ...profileWithoutCandidate,
    json: serializeImport(effective),
    upstreamJson: profile.pendingUpstreamJson,
    sourceOverridesJson: serializeSubscriptionSourceOverrides(overrides),
    sourceCount: effective.sites.length,
    importedAt: now,
  };
  const members = group.members.map((item) => {
    if (item.id !== memberId) return item;
    const resolved = { ...item };
    delete resolved.refreshDiff;
    delete resolved.error;
    return { ...resolved, status: 'ready' as const };
  });

  let next: UserConfig = {
    ...config,
    profiles: config.profiles.map((item) => item.id === profile.id ? updatedProfile : item),
    subscriptionGroups: config.subscriptionGroups.map((item) => item.id !== groupId ? item : {
      ...item,
      members,
      status: subscriptionGroupStatus(members),
      updatedAt: now,
    }),
  };

  if (next.activeProfileId === profile.id) {
    next = {
      ...next,
      apiUrl: updatedProfile.apiUrl,
      global: { spider: effective.spider || '', flags: [...(effective.flags || [])] },
      sources: effective.sites.map((source) => ({ ...source })),
      lives: effective.lives.map((live) => ({ ...live, header: live.header ? { ...live.header } : undefined })),
      parses: realParses(effective.parses),
    };
    if (!next.sources.some((source) => source.key === next.ui.activeSourceKey)) {
      next.ui = { ...next.ui, activeSourceKey: '' };
    }
    next.ui = {
      ...next.ui,
      activeLiveIndex: clampIndex(next.ui.activeLiveIndex, next.lives.length),
    };
  }

  return next;
}

function subscriptionGroupStatus(members: UserConfig['subscriptionGroups'][number]['members']): 'complete' | 'partial' | 'failed' {
  const hasReadyMember = members.some((member) => member.status === 'ready');
  const hasIncompleteMember = members.some((member) => member.status !== 'ready');
  if (hasReadyMember) return hasIncompleteMember ? 'partial' : 'complete';
  return members.length ? 'failed' : 'complete';
}

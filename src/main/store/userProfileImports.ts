import type { SiteConfig, UserConfig, UserProfile } from '../../shared/types';
import { filterDeletedProfileSources, restoreProfileSourceKeys, sourceDeletionKeys, withSourceDeletionKeys } from './sourceDeletionScopes';
import { clampIndex } from './userConfigNormalization';
import { mergeLocalLives, profileSnapshotLives } from './userConfigProfileState';
import { isAutoProfileName, profileIdSlug, subscriptionStamp } from './userProfileNaming';
import { realParses, serializeImport } from './userProfileSnapshot';

export interface ProfileImportOptions {
  profileName?: string;
  restoreDeletedSourceKeys: readonly string[];
}

export interface ImportedProfileSource {
  parsed?: SiteConfig;
  apiUrl?: string;
}

/** Build a subscription replacement; persistence and diagnostic logging remain outside. */
export function replaceImportedProfileConfig(
  config: UserConfig,
  parsed: SiteConfig,
  apiUrl: string,
  options: ProfileImportOptions & { now: Date; version: number },
): { config: UserConfig; filteredSourceKeys: string[] } {
  const base = restoreProfileSourceKeys(config, options.restoreDeletedSourceKeys);
  const filtered = filterDeletedProfileSources(base, parsed.sites.map((source) => ({ ...source })));
  const importedAt = options.now.toISOString();
  const next: UserConfig = {
    ...base,
    version: options.version,
    apiUrl: apiUrl || base.apiUrl,
    global: { spider: parsed.spider || '', flags: Array.isArray(parsed.flags) ? [...parsed.flags] : [] },
    sources: filtered.sources,
    lives: parsed.lives.map((live) => ({ ...live, header: live.header ? { ...live.header } : undefined })),
    parses: realParses(parsed.parses),
    profiles: base.profiles.map((profile) => profile.id === base.activeProfileId ? {
      ...profile,
      ...(options.profileName ? { name: options.profileName } : {}),
      apiUrl: apiUrl || profile.apiUrl,
      json: serializeImport({ ...parsed, sites: filtered.sources }),
      sourceCount: filtered.sources.length,
      importedAt,
    } : profile),
    ui: {
      ...base.ui,
      activeSourceKey: filtered.sources.some((source) => source.key === base.ui.activeSourceKey) ? base.ui.activeSourceKey : '',
    },
  };

  if (!next.activeProfileId && (next.sources.length > 0 || next.lives.length > 0) && next.profiles.length === 0) {
    const first: UserProfile = {
      id: profileIdSlug(apiUrl, `profile-${options.now.getTime().toString(36)}`) || 'default',
      name: options.profileName || `新订阅 ${subscriptionStamp(options.now)}`,
      apiUrl: apiUrl || '',
      json: serializeImport({ ...parsed, sites: filtered.sources }),
      sourceCount: filtered.sources.length,
      importedAt,
    };
    next.profiles = [first];
    next.activeProfileId = first.id;
    next.deletedSourceKeysByProfile = withSourceDeletionKeys(next, sourceDeletionKeys(base), first.id).deletedSourceKeysByProfile;
  }
  const merged = mergeLocalLives(next, config.lives);
  return {
    config: { ...merged, ui: { ...merged.ui, activeLiveIndex: clampIndex(merged.ui.activeLiveIndex, merged.lives.length) } },
    filteredSourceKeys: filtered.filteredSourceKeys,
  };
}

/** Create/activate a profile in one immutable transition, optionally archiving its predecessor. */
export function createProfileFromConfig(
  config: UserConfig,
  name: string,
  source: ImportedProfileSource | undefined,
  options: { now: Date; previousProfileName?: string; restoreDeletedSourceKeys?: readonly string[] },
): { config: UserConfig; profile: UserProfile; filteredSourceKeys: string[] } {
  const base = restoreProfileSourceKeys(config, options.restoreDeletedSourceKeys ?? []);
  const apiUrl = source?.apiUrl || base.apiUrl || '';
  const parsed = source?.parsed ?? {
    sites: base.sources, lives: base.lives, spider: base.global.spider, flags: base.global.flags, parses: base.parses,
  };
  const profile: UserProfile = {
    id: profileIdSlug(name, `profile-${options.now.getTime().toString(36)}`) + '-' + options.now.getTime().toString(36).slice(-4),
    name: name.trim() || '未命名配置',
    apiUrl,
    json: serializeImport({ ...parsed, lives: profileSnapshotLives(parsed.lives) } as SiteConfig),
    sourceCount: parsed.sites.length,
    importedAt: options.now.toISOString(),
  };
  const filtered = source?.parsed
    ? filterDeletedProfileSources(base, parsed.sites.map((item) => ({ ...item })), profile.id)
    : { sources: base.sources, filteredSourceKeys: [] };
  const next: UserConfig = {
    ...base,
    profiles: [
      ...base.profiles.map((item) => options.previousProfileName !== undefined && item.id === base.activeProfileId && isAutoProfileName(item)
        ? { ...item, name: options.previousProfileName }
        : item),
      profile,
    ],
    activeProfileId: profile.id,
    ...(source?.parsed ? {
      apiUrl,
      global: { spider: parsed.spider || '', flags: Array.isArray(parsed.flags) ? [...parsed.flags] : [] },
      sources: filtered.sources,
      lives: parsed.lives.map((live) => ({ ...live, header: live.header ? { ...live.header } : undefined })),
      parses: realParses(parsed.parses),
    } : {}),
    ui: {
      ...base.ui,
      activeSourceKey: filtered.sources.some((item) => item.key === base.ui.activeSourceKey) ? base.ui.activeSourceKey : '',
    },
  };
  const merged = mergeLocalLives(source?.parsed ? next : withSourceDeletionKeys(next, sourceDeletionKeys(base)), config.lives);
  return {
    config: { ...merged, ui: { ...merged.ui, activeLiveIndex: clampIndex(merged.ui.activeLiveIndex, merged.lives.length) } },
    profile: { ...profile },
    filteredSourceKeys: filtered.filteredSourceKeys,
  };
}

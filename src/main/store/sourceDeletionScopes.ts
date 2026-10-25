import type { SourceBean, UserConfig } from '../../shared/types';

type DeletionConfig = Pick<UserConfig, 'activeProfileId' | 'deletedSourceKeys' | 'deletedSourceKeysByProfile'>;

function keys(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean))]
    : [];
}

/** Older files did not record the owning profile. Migrate only to their active profile. */
export function normalizeSourceDeletionScopes(raw: unknown, profileIds: ReadonlySet<string>, activeId: string, legacy: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    const migrated = keys(legacy);
    return migrated.length ? { [activeId]: migrated } : {};
  }
  return Object.fromEntries(Object.entries(raw)
    .filter(([id]) => id === '' || profileIds.has(id))
    .map(([id, value]) => [id, keys(value)]));
}

export function sourceDeletionKeys(config: DeletionConfig, profileId = config.activeProfileId): readonly string[] {
  const scopes = config.deletedSourceKeysByProfile;
  if (scopes) return Object.hasOwn(scopes, profileId) ? scopes[profileId] : [];
  return profileId === config.activeProfileId ? config.deletedSourceKeys : [];
}

export function withSourceDeletionKeys<T extends DeletionConfig>(config: T, value: readonly string[], profileId = config.activeProfileId): T {
  const next = keys(value);
  return {
    ...config,
    deletedSourceKeysByProfile: { ...config.deletedSourceKeysByProfile, [profileId]: next },
    ...(profileId === config.activeProfileId ? { deletedSourceKeys: next } : {}),
  };
}

/** Apply a profile's deletion policy without logging or mutating either snapshot. */
export function filterDeletedProfileSources(config: DeletionConfig, sources: readonly SourceBean[], profileId = config.activeProfileId) {
  const deleted = new Set(sourceDeletionKeys(config, profileId));
  return {
    sources: sources.filter((source) => !deleted.has(source.key)),
    filteredSourceKeys: sources.filter((source) => deleted.has(source.key)).map((source) => source.key),
  };
}

/** Restore explicitly re-imported source keys only in their owning profile. */
export function restoreProfileSourceKeys<T extends DeletionConfig>(config: T, restoredKeys: readonly string[]): T {
  if (!restoredKeys.length) return config;
  const restored = new Set(restoredKeys.map(String));
  const current = sourceDeletionKeys(config);
  const next = current.filter((key) => !restored.has(key));
  return next.length === current.length ? config : withSourceDeletionKeys(config, next);
}

import type { UserConfig } from '../../shared/types';

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

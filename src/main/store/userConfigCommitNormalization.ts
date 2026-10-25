import { normalizeSourceDeletionScopes, sourceDeletionKeys } from './sourceDeletionScopes';
import type { UserConfig } from '../../shared/types';

/** Normalize cross-profile deletion scopes and active-source invariants before committing a snapshot. */
export function normalizeUserConfigForCommit(config: UserConfig): UserConfig {
  const deletedSourceKeysByProfile = normalizeSourceDeletionScopes(
    config.deletedSourceKeysByProfile,
    new Set(config.profiles.map((profile) => profile.id)),
    config.activeProfileId,
    config.deletedSourceKeys,
  );
  const globallyBlockedSourceKeys = [...new Set(
    (config.globallyBlockedSourceKeys ?? [])
      .filter((key): key is string => typeof key === 'string')
      .map((key) => key.trim())
      .filter(Boolean),
  )];
  let next: UserConfig = {
    ...config,
    deletedSourceKeysByProfile,
    deletedSourceKeys: [...sourceDeletionKeys({ ...config, deletedSourceKeysByProfile })],
    globallyBlockedSourceKeys,
  };
  if (globallyBlockedSourceKeys.includes(next.ui.activeSourceKey)) {
    next = { ...next, ui: { ...next.ui, activeSourceKey: '' } };
  }
  return next;
}

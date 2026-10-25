import type { UserConfig } from '../../shared/types';

/** Local-import lifecycle operations needed by configuration use cases. */
export interface LocalPackageReferencePort {
  migrateConfig?(config: UserConfig, warn?: (message: string) => void): UserConfig;
  cleanupRemoved?(before: UserConfig, after: UserConfig): void;
}

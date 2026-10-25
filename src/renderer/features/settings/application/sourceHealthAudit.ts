import type { AuditItem, SourceBean } from '../../../../shared/types';

export interface SourceHealthAuditPort {
  run(): Promise<AuditItem[]>;
  deleteSource(sourceKey: string): Promise<void>;
  renameProfile(profileId: string, name: string): Promise<void>;
  saveProfile(name: string): Promise<{ name: string }>;
}

export type FailedSourceCleanupResult =
  | { kind: 'no-failed-sources' }
  | { kind: 'nothing-removed'; failedCount: number }
  | { kind: 'all-removed'; deletedCount: number; deleteFailureCount: number }
  | {
      kind: 'removed';
      deletedCount: number;
      deleteFailureCount: number;
      remainingCount: number;
      profileName: string;
      profileUpdateError: string;
    };

export async function removeFailedSources(
  audit: readonly AuditItem[],
  sources: readonly SourceBean[],
  activeProfileId: string,
  activeProfileName: string,
  port: SourceHealthAuditPort,
): Promise<FailedSourceCleanupResult> {
  const failed = audit.filter((item) => item.health === 'error');
  if (failed.length === 0) return { kind: 'no-failed-sources' };

  const deletedKeys = new Set<string>();
  let deleteFailureCount = 0;
  for (const item of failed) {
    try {
      await port.deleteSource(item.key);
      deletedKeys.add(item.key);
    } catch {
      deleteFailureCount += 1;
    }
  }

  const deletedCount = deletedKeys.size;
  if (deletedCount === 0) return { kind: 'nothing-removed', failedCount: failed.length };

  const remainingCount = sources.filter((source) => !deletedKeys.has(source.key)).length;
  if (remainingCount === 0) {
    return { kind: 'all-removed', deletedCount, deleteFailureCount };
  }

  let profileName = cleanedProfileName(activeProfileName, remainingCount);
  let profileUpdateError = '';
  try {
    if (activeProfileId) await port.renameProfile(activeProfileId, profileName);
    else profileName = (await port.saveProfile(profileName)).name;
  } catch (error) {
    profileUpdateError = error instanceof Error ? error.message : String(error);
  }

  return { kind: 'removed', deletedCount, deleteFailureCount, remainingCount, profileName, profileUpdateError };
}

function cleanedProfileName(currentName: string, remainingCount: number): string {
  const base = currentName
    .replace(/[（(]\s*\d+\s*源\s*[）)]\s*$/, '')
    .replace(/\s*\d{2}-\d{2}\s+\d{2}:\d{2}\s*$/, '')
    .replace(/^清理后\s*/, '')
    .trim() || '订阅';
  return `${base}(${remainingCount}源)`;
}

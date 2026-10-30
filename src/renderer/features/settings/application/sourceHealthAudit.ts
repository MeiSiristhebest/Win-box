import type { AuditItem, SourceBean } from '../../../../shared/types';

export interface SourceHealthAuditPort {
  run(profileId: string): Promise<AuditItem[]>;
  deleteSources(sourceKeys: readonly string[], expectedProfileId: string): Promise<string[]>;
}

export type FailedSourceCleanupResult =
  | { kind: 'no-failed-sources' }
  | { kind: 'nothing-removed'; failedCount: number }
  | { kind: 'all-removed'; deletedCount: number }
  | { kind: 'removed'; deletedCount: number; remainingCount: number };

export async function removeFailedSources(
  audit: readonly AuditItem[],
  sources: readonly SourceBean[],
  expectedProfileId: string,
  port: SourceHealthAuditPort,
): Promise<FailedSourceCleanupResult> {
  const currentKeys = new Set(sources.map((source) => source.key));
  const failedKeys = [...new Set(audit.filter((item) => item.health === 'error' && currentKeys.has(item.key)).map((item) => item.key))];
  if (failedKeys.length === 0) return { kind: 'no-failed-sources' };

  const deletedKeys = new Set(await port.deleteSources(failedKeys, expectedProfileId));
  const deletedCount = failedKeys.filter((key) => deletedKeys.has(key)).length;
  if (deletedCount === 0) return { kind: 'nothing-removed', failedCount: failedKeys.length };

  const remainingCount = sources.filter((source) => !deletedKeys.has(source.key)).length;
  if (remainingCount === 0) {
    return { kind: 'all-removed', deletedCount };
  }
  return { kind: 'removed', deletedCount, remainingCount };
}

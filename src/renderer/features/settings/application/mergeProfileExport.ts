export interface MergeProfileSummary {
  kept?: number;
  total?: number;
}

export interface MergeProfileExportPort {
  mergeProfiles(profileIds: string[]): Promise<{
    content: string;
    summary: MergeProfileSummary[];
  }>;
  saveMergedFile(content: string): Promise<{ saved: boolean; path: string }>;
}

export type MergeProfileExportResult =
  | { kind: 'saved'; path: string; profileCount: number; keptSourceCount: number; totalSourceCount: number }
  | { kind: 'cancelled' };

/** Coordinates merging selected profiles and saving the generated subscription. */
export async function mergeAndSaveProfiles(
  profileIds: string[],
  port: MergeProfileExportPort,
): Promise<MergeProfileExportResult> {
  const ids = [...new Set(profileIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) throw new Error('请先勾选要合并的配置档案');

  const merged = await port.mergeProfiles(ids);
  const keptSourceCount = merged.summary.reduce((total, item) => total + (item.kept ?? 0), 0);
  const totalSourceCount = merged.summary.reduce((total, item) => total + (item.total ?? 0), 0);
  const saved = await port.saveMergedFile(merged.content);

  if (!saved.saved) return { kind: 'cancelled' };
  return {
    kind: 'saved',
    path: saved.path,
    profileCount: merged.summary.length,
    keptSourceCount,
    totalSourceCount,
  };
}

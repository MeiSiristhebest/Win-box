import { createHash } from 'node:crypto';
import type { MultiRepo } from '../../engine/config/multiRepo';
import type { SubscriptionProfileRefreshResult } from '../store/subscriptionProfileMerge';
import type { ImportReport, SiteConfig, SourceBean, SubscriptionGroup, UserConfig, UserProfile } from '../../shared/types';
import type { SubscriptionImportPolicy } from './ImportPolicy';
import type { executeSubscriptionImportBatch, SubscriptionImportBatchProgress, SubscriptionImportBatchResult } from './SubscriptionImportExecutor';

type SubscriptionImportItem = MultiRepo['items'][number];
type SubscriptionImportResult = { config: SiteConfig; report: ImportReport; warnings?: string[] };
type SubscriptionImportBatch = SubscriptionImportBatchResult<SubscriptionImportItem, SubscriptionImportResult>;
type SubscriptionGroupMember = SubscriptionGroup['members'][number];

export interface SubscriptionImportGroupDependencies {
  labelFor(item: SubscriptionImportItem): string;
  splitRepoLine(rawUrl: string): { url: string; line: number };
  serializeImport(config: SiteConfig): string;
  reconcileProfileRefresh(
    incoming: readonly SourceBean[],
    previous: Pick<UserProfile, 'json' | 'upstreamJson' | 'sourceOverridesJson'> | undefined,
    incomingSnapshotJson: string,
  ): SubscriptionProfileRefreshResult;
}

export interface PreparedSubscriptionImportGroup {
  rootUrl: string;
  oldGroup: SubscriptionGroup | null;
  memberIds: string[];
  selectedIndices: number[];
  previousMembers: Map<string, SubscriptionGroupMember>;
  groupId: string;
}

export interface AssembledSubscriptionImportGroup {
  group: SubscriptionGroup;
  importedProfiles: UserProfile[];
  imported: NonNullable<SubscriptionImportBatch['completed'][number]>[];
  skipped: string[];
  truncated: number;
  unselected: number;
  successCount: number;
  failedCount: number;
  pendingCount: number;
  activateProfileId?: string;
}

export interface SubscriptionImportGroupCommitPort {
  readonly revision: number;
  commitSubscriptionGroup(
    group: SubscriptionGroup,
    importedProfiles: UserProfile[],
    activateProfileId?: string,
    expectedRevision?: number,
    restoreDeletedSources?: boolean,
  ): void;
}

export interface SubscriptionGroupProfilePort extends SubscriptionImportGroupCommitPort {
  snapshot(): SubscriptionImportSnapshot;
}

type SubscriptionImportSnapshot = Pick<UserConfig, 'subscriptionGroups' | 'profiles' | 'activeProfileId'>;

export function prepareSubscriptionImportGroup(options: {
  items: readonly SubscriptionImportItem[];
  subscriptionUrl: string;
  onlyMemberIds?: ReadonlySet<string>;
  snapshot: SubscriptionImportSnapshot;
  splitRepoLine: SubscriptionImportGroupDependencies['splitRepoLine'];
}): PreparedSubscriptionImportGroup {
  const rootUrl = options.subscriptionUrl || `inline:${hash(JSON.stringify(options.items)).slice(0, 24)}`;
  const oldGroup = options.snapshot.subscriptionGroups.find((group) => group.url === rootUrl) ?? null;
  const seenIdentity = new Map<string, number>();
  const memberIds = options.items.map((item) => {
    const ref = options.splitRepoLine(item.url);
    const identity = `${ref.url}\n${ref.line}`;
    const occurrence = seenIdentity.get(identity) ?? 0;
    seenIdentity.set(identity, occurrence + 1);
    return hash(`${identity}\n${occurrence}`).slice(0, 24);
  });
  const selectedIndices = options.items.flatMap((_, index) =>
    !options.onlyMemberIds || options.onlyMemberIds.has(memberIds[index]) ? [index] : []);
  const previousMembers = new Map((oldGroup?.members ?? []).map((member) => [member.id, member]));
  const groupId = oldGroup?.id || `multi-${hash(rootUrl).slice(0, 24)}`;

  return { rootUrl, oldGroup, memberIds, selectedIndices, previousMembers, groupId };
}

export function assembleSubscriptionImportGroup(options: {
  items: readonly SubscriptionImportItem[];
  name: string;
  subscriptionUrl: string;
  snapshot: SubscriptionImportSnapshot;
  prepared: PreparedSubscriptionImportGroup;
  batch: SubscriptionImportBatch;
  dependencies: SubscriptionImportGroupDependencies;
  now?: string;
}): AssembledSubscriptionImportGroup {
  const { items, name, subscriptionUrl, snapshot, prepared, batch, dependencies } = options;
  const now = options.now ?? new Date().toISOString();
  const selectedSet = new Set(batch.candidateIndices);
  const imported = batch.completed.flatMap((item) => item ? [item] : []);
  const skipped = batch.skippedByIndex.filter((item): item is string => item !== null);
  const unselected = items.length - prepared.selectedIndices.length;
  const oldProfiles = new Map(snapshot.profiles.map((profile) => [profile.id, profile]));
  const importedProfiles: UserProfile[] = [];
  const presentIds = new Set(prepared.memberIds);
  const members: SubscriptionGroup['members'] = items.map((item, index) => {
    const id = prepared.memberIds[index];
    const previous = prepared.previousMembers.get(id);
    const fetched = batch.completed[index];
    const label = dependencies.labelFor(item);
    const ref = dependencies.splitRepoLine(item.url);
    if (!selectedSet.has(index) && previous) return { ...previous };
    if (fetched) {
      const profileId = previous?.profileId || `sub-${hash(`${prepared.groupId}\n${id}`).slice(0, 24)}`;
      const previousProfile = previous?.profileId ? oldProfiles.get(previous.profileId) : undefined;
      const profileName = previousProfile?.name || previous?.name || label;
      const incomingSnapshotJson = dependencies.serializeImport(fetched.result.config);
      const refresh = dependencies.reconcileProfileRefresh(
        fetched.result.config.sites,
        previousProfile,
        incomingSnapshotJson,
      );
      const effectiveConfig = { ...fetched.result.config, sites: refresh.sources };
      importedProfiles.push({
        id: profileId,
        name: profileName,
        apiUrl: item.url,
        json: refresh.preserveCurrentProfile && previousProfile ? previousProfile.json : dependencies.serializeImport(effectiveConfig),
        ...(refresh.upstreamJson ? { upstreamJson: refresh.upstreamJson } : {}),
        ...(refresh.pendingUpstreamJson ? { pendingUpstreamJson: refresh.pendingUpstreamJson } : {}),
        sourceOverridesJson: refresh.sourceOverridesJson,
        sourceCount: effectiveConfig.sites.length,
        importedAt: now,
        groupId: prepared.groupId,
        memberId: id,
      });
      return {
        id,
        profileId,
        name: profileName,
        url: item.url,
        ...(ref.line >= 0 ? { line: ref.line } : {}),
        status: refresh.pendingUpstreamJson ? 'needs-review' : 'ready',
        lastAttemptAt: now,
        lastSuccessAt: now,
        ...(refresh.refreshDiff ? { refreshDiff: refresh.refreshDiff } : previous?.refreshDiff ? { refreshDiff: previous.refreshDiff } : {}),
      };
    }
    const notAttempted = !selectedSet.has(index) || batch.pendingByIndex[index];
    return {
      id,
      ...(previous?.profileId ? { profileId: previous.profileId } : {}),
      name: previous?.name || label,
      url: item.url,
      ...(ref.line >= 0 ? { line: ref.line } : {}),
      status: notAttempted ? 'pending' : 'failed',
      error: batch.skippedByIndex[index] || (notAttempted ? '尚未尝试，可继续处理' : '导入失败'),
      lastAttemptAt: notAttempted ? previous?.lastAttemptAt : now,
      ...(previous?.lastSuccessAt ? { lastSuccessAt: previous.lastSuccessAt } : {}),
      ...(previous?.refreshDiff ? { refreshDiff: previous.refreshDiff } : {}),
    };
  });

  for (const previous of prepared.oldGroup?.members ?? []) {
    if (!presentIds.has(previous.id)) members.push({ ...previous, status: 'pending-removal' });
  }
  const failedCount = members.filter((member) => member.status === 'failed').length;
  const pendingCount = members.filter((member) => member.status === 'pending' || member.status === 'pending-removal' || member.status === 'needs-review').length;
  const successCount = members.filter((member) => member.status === 'ready').length;
  const group: SubscriptionGroup = {
    id: prepared.groupId,
    name: prepared.oldGroup?.name || name.trim() || (subscriptionUrl ? dependencies.labelFor({ url: subscriptionUrl }) : '多仓订阅'),
    url: prepared.rootUrl,
    members,
    status: successCount > 0 ? (failedCount || pendingCount ? 'partial' : 'complete') : pendingCount ? 'partial' : 'failed',
    createdAt: prepared.oldGroup?.createdAt || now,
    updatedAt: now,
    ...(successCount > 0 ? { lastRefreshAt: now } : prepared.oldGroup?.lastRefreshAt ? { lastRefreshAt: prepared.oldGroup.lastRefreshAt } : {}),
  };
  const currentProfileIsMember = prepared.oldGroup?.members.some((member) => member.profileId === snapshot.activeProfileId) ?? false;
  const activeProfileUpdated = importedProfiles.find((profile) => profile.id === snapshot.activeProfileId);
  const activateProfileId = currentProfileIsMember
    ? activeProfileUpdated?.id
    : !prepared.oldGroup || prepared.oldGroup.members.length === 0
      ? importedProfiles[0]?.id
      : undefined;

  return {
    group,
    importedProfiles,
    imported,
    skipped,
    truncated: batch.truncated,
    unselected,
    successCount,
    failedCount,
    pendingCount,
    ...(activateProfileId ? { activateProfileId } : {}),
  };
}

export function commitSubscriptionImportGroup(options: {
  manager: SubscriptionImportGroupCommitPort;
  assembled: AssembledSubscriptionImportGroup;
  expectedRevision?: number;
  restoreDeletedSources?: boolean;
  onRevisionConflict?: (message: string) => void;
}): void {
  if (options.expectedRevision !== undefined && options.manager.revision !== options.expectedRevision) {
    const message = '配置已在导入期间更改；多仓下载结果未保存，请重新导入';
    options.onRevisionConflict?.(message);
    throw new Error(message);
  }
  const args: [SubscriptionGroup, UserProfile[], string | undefined, number | undefined] = [
    options.assembled.group, options.assembled.importedProfiles, options.assembled.activateProfileId, options.expectedRevision,
  ];
  if (options.restoreDeletedSources) options.manager.commitSubscriptionGroup(...args, true);
  else options.manager.commitSubscriptionGroup(...args);
}

export async function runSubscriptionImportGroup(options: {
  manager: SubscriptionGroupProfilePort;
  executeBatch: typeof executeSubscriptionImportBatch;
  items: readonly SubscriptionImportItem[];
  name: string;
  subscriptionUrl: string;
  onlyMemberIds?: ReadonlySet<string>;
  expectedRevision?: number;
  restoreDeletedSources?: boolean;
  signal?: AbortSignal;
  policy: Pick<SubscriptionImportPolicy, 'maxConcurrentChildren' | 'maxItemsPerRun' | 'itemTimeoutMs' | 'totalDurationMs'>;
  dependencies: SubscriptionImportGroupDependencies;
  unavailableReason?: (item: SubscriptionImportItem, index: number) => string | null;
  load: (item: SubscriptionImportItem, signal: AbortSignal) => Promise<SubscriptionImportResult>;
  onProgress?: (progress: SubscriptionImportBatchProgress) => void;
  onRevisionConflict?: (message: string) => void;
}): Promise<AssembledSubscriptionImportGroup> {
  const snapshot = options.manager.snapshot();
  const prepared = prepareSubscriptionImportGroup({
    items: options.items,
    subscriptionUrl: options.subscriptionUrl,
    onlyMemberIds: options.onlyMemberIds,
    snapshot,
    splitRepoLine: options.dependencies.splitRepoLine,
  });
  const batch = await options.executeBatch({
    items: options.items,
    selectedIndices: prepared.selectedIndices,
    signal: options.signal,
    policy: options.policy,
    labelFor: options.dependencies.labelFor,
    unavailableReason: options.unavailableReason,
    load: options.load,
    initialCounts: (selected) => {
      let succeeded = 0;
      let failed = 0;
      for (let index = 0; index < options.items.length; index++) {
        if (selected.has(index)) continue;
        const previous = prepared.previousMembers.get(prepared.memberIds[index]);
        if (previous?.status === 'ready') succeeded++;
        else if (previous?.status === 'failed') failed++;
      }
      return { succeeded, failed };
    },
    onProgress: options.onProgress,
  });

  if (batch.cancelled || options.signal?.aborted) {
    throw options.signal?.reason ?? new Error('导入已取消；未提交本轮结果');
  }
  const assembled = assembleSubscriptionImportGroup({
    items: options.items,
    name: options.name,
    subscriptionUrl: options.subscriptionUrl,
    snapshot,
    prepared,
    batch,
    dependencies: options.dependencies,
  });
  commitSubscriptionImportGroup({
    manager: options.manager,
    assembled,
    expectedRevision: options.expectedRevision,
    restoreDeletedSources: options.restoreDeletedSources,
    onRevisionConflict: options.onRevisionConflict,
  });
  options.onProgress?.({
    total: options.items.length,
    completed: batch.succeeded + batch.failed,
    succeeded: batch.succeeded,
    failed: batch.failed,
    pending: Math.max(0, options.items.length - batch.succeeded - batch.failed),
  });
  return assembled;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

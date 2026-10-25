import { parseSite } from '../../engine/config/SiteParser';
import { parseLives } from '../../engine/config/LiveConfigParser';
import { normalizeSourceDeletionScopes } from './sourceDeletionScopes';
import type { ParseBean, SourceBean, SubscriptionSourceRefreshDiff, UserConfig, UserProfile, SubscriptionGroup } from '../../shared/types';

export interface UserConfigNormalizationDiagnostic {
  level: 'info' | 'warning';
  message: string;
}

export interface UserConfigNormalizationResult {
  config: UserConfig;
  diagnostics: UserConfigNormalizationDiagnostic[];
}

function sanitizeParses(raw: unknown[]): ParseBean[] {
  const out: ParseBean[] = [];
  for (const e of raw) {
    const o = (e ?? {}) as Record<string, unknown>;
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    const url = typeof o.url === 'string' ? o.url.trim() : '';
    if (!name || !url) continue;
    out.push({ name, url, ext: typeof o.ext === 'string' ? o.ext : '', type: Number(o.type) || 0 });
  }
  return out;
}

function normalizeRefreshDiff(value: unknown): SubscriptionSourceRefreshDiff | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.addedKeys) || !Array.isArray(raw.removedKeys) || !Array.isArray(raw.changed)) return undefined;
  const addedKeys = raw.addedKeys.filter((item): item is string => typeof item === 'string');
  const removedKeys = raw.removedKeys.filter((item): item is string => typeof item === 'string');
  const changed = raw.changed.flatMap((item): SubscriptionSourceRefreshDiff['changed'] => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const entry = item as Record<string, unknown>;
    if (typeof entry.key !== 'string' || !Array.isArray(entry.fields)) return [];
    return [{ key: entry.key, fields: entry.fields.filter((field): field is string => typeof field === 'string') }];
  });
  return { addedKeys, removedKeys, changed };
}

export function clampIndex(i: number, len: number): number {
  if (!Number.isFinite(i) || i < 0) return 0;
  if (len <= 0) return 0;
  return Math.min(Math.floor(i), len - 1);
}

export function normalizeLoadedUserConfig(raw: UserConfig, currentVersion: number, now: Date): UserConfigNormalizationResult {
  const diagnostics: UserConfigNormalizationDiagnostic[] = [];
  const addInfo = (message: string): void => { diagnostics.push({ level: 'info', message }); };
  const addWarning = (message: string): void => { diagnostics.push({ level: 'warning', message }); };
  let version = typeof raw?.version === 'number' ? raw.version : currentVersion;
  if (version < currentVersion) {
    addInfo(`user-config 版本 ${version} → ${currentVersion}（执行迁移）`);
    version = currentVersion;
  }
  // 逐条 source 校验：坏源剔除 + 日志说明（不静默保留坏数据）
  const sources: SourceBean[] = [];
  const rawSources = Array.isArray(raw?.sources) ? raw.sources : [];
  rawSources.forEach((s, i) => {
    const r = parseSite(s as unknown, i);
    if (r.bean) {
      sources.push(r.bean);
    } else {
      addWarning(`user-config 剔除坏源 [${i}] key=${r.report.key} message=${r.report.message}`);
    }
  });
  const lives = parseLives(Array.isArray(raw?.lives) ? (raw.lives as unknown[]) : []);
  const global = raw?.global && typeof raw.global === 'object' ? raw.global : { spider: '', flags: [] };
  const ui = raw?.ui && typeof raw.ui === 'object' ? raw.ui : { activeSourceKey: '', activeLiveIndex: 0 };
  // v2：profiles（多 JSON 源档案）
  const rawProfiles = Array.isArray((raw as { profiles?: unknown }).profiles) ? (raw as { profiles: unknown[] }).profiles : [];
  let profiles: UserProfile[] = rawProfiles
    .map((p) => {
      const o = p as Record<string, unknown>;
      if (!o || typeof o !== 'object') return null;
      const id = typeof o.id === 'string' && o.id ? o.id : '';
      if (!id) return null;
      return {
        id,
        name: typeof o.name === 'string' && o.name ? o.name : id,
        apiUrl: typeof o.apiUrl === 'string' ? o.apiUrl : '',
        // Validate recognizable snapshots at load time. Keep malformed legacy text
        // so the user can still recover/export it instead of silently replacing it.
        json: typeof o.json === 'string' ? o.json : '',
        sourceCount: Number(o.sourceCount) || 0,
        importedAt: typeof o.importedAt === 'string' ? o.importedAt : new Date(0).toISOString(),
        ...(typeof o.upstreamJson === 'string' ? { upstreamJson: o.upstreamJson } : {}),
        ...(typeof o.pendingUpstreamJson === 'string' ? { pendingUpstreamJson: o.pendingUpstreamJson } : {}),
        ...(typeof o.sourceOverridesJson === 'string' ? { sourceOverridesJson: o.sourceOverridesJson } : {}),
        ...(typeof o.groupId === 'string' && o.groupId ? { groupId: o.groupId } : {}),
        ...(typeof o.memberId === 'string' && o.memberId ? { memberId: o.memberId } : {}),
      };
    })
    .filter((p): p is UserProfile => p !== null);
  let activeProfileId = typeof (raw as { activeProfileId?: unknown }).activeProfileId === 'string' ? (raw as { activeProfileId: string }).activeProfileId : '';
  // v1→v2 迁移：无 profiles 的旧档补一个默认档案占位（json 空 = 保留现有源列表语义）
  if (profiles.length === 0 && (sources.length > 0 || lives.length > 0)) {
    const defId = 'default';
    profiles = [
      {
        id: defId,
        name: '默认',
        apiUrl: typeof raw?.apiUrl === 'string' ? raw.apiUrl : '',
        json: '',
        sourceCount: sources.length,
        importedAt: now.toISOString(),
      },
    ];
    activeProfileId = defId;
  }
  if (activeProfileId && !profiles.some((p) => p.id === activeProfileId)) activeProfileId = '';
  if (profiles.length === 0) activeProfileId = '';
  const profileIds = new Set(profiles.map((profile) => profile.id));
  const deletedSourceKeysByProfile = normalizeSourceDeletionScopes(raw.deletedSourceKeysByProfile, profileIds, activeProfileId, raw.deletedSourceKeys);
  const rawGroups = Array.isArray((raw as { subscriptionGroups?: unknown })?.subscriptionGroups)
    ? (raw as { subscriptionGroups: unknown[] }).subscriptionGroups
    : [];
  const subscriptionGroups: SubscriptionGroup[] = rawGroups.flatMap((value): SubscriptionGroup[] => {
    if (!value || typeof value !== 'object') return [];
    const group = value as Record<string, unknown>;
    if (typeof group.id !== 'string' || !group.id || typeof group.url !== 'string' || !group.url) return [];
    const members: SubscriptionGroup['members'] = (Array.isArray(group.members) ? group.members : [])
      .flatMap((value): SubscriptionGroup['members'] => {
        if (!value || typeof value !== 'object') return [];
        const member = value as Record<string, unknown>;
        if (typeof member.id !== 'string' || !member.id || typeof member.url !== 'string' || !member.url) return [];
        const profileId = typeof member.profileId === 'string' && profileIds.has(member.profileId)
          ? member.profileId
          : undefined;
        const refreshDiff = normalizeRefreshDiff(member.refreshDiff);
        return [{
          id: member.id,
          ...(profileId ? { profileId } : {}),
          name: typeof member.name === 'string' && member.name ? member.name : member.url,
          url: member.url,
          ...(Number.isInteger(member.line) && Number(member.line) >= 0 ? { line: Number(member.line) } : {}),
          status: member.status === 'failed' || member.status === 'pending' || member.status === 'pending-removal' || member.status === 'needs-review'
            ? member.status
            : 'ready',
          ...(typeof member.error === 'string' && member.error ? { error: member.error } : {}),
          ...(typeof member.lastAttemptAt === 'string' ? { lastAttemptAt: member.lastAttemptAt } : {}),
          ...(typeof member.lastSuccessAt === 'string' ? { lastSuccessAt: member.lastSuccessAt } : {}),
          ...(refreshDiff ? { refreshDiff } : {}),
        }];
      });
    return [{
      id: group.id,
      name: typeof group.name === 'string' && group.name ? group.name : group.id,
      url: group.url,
      members,
      status: group.status === 'partial' || group.status === 'failed' ? group.status : 'complete',
      createdAt: typeof group.createdAt === 'string' ? group.createdAt : new Date(0).toISOString(),
      updatedAt: typeof group.updatedAt === 'string' ? group.updatedAt : new Date(0).toISOString(),
      ...(typeof group.lastRefreshAt === 'string' ? { lastRefreshAt: group.lastRefreshAt } : {}),
    }];
  });
  const next: UserConfig = {
    version,
    apiUrl: typeof raw?.apiUrl === 'string' ? raw.apiUrl : '',
    global: {
      spider: typeof global.spider === 'string' ? global.spider : '',
      flags: Array.isArray(global.flags) ? global.flags.map(String) : [],
    },
    sources,
    lives,
    parses: sanitizeParses(Array.isArray((raw as { parses?: unknown })?.parses) ? ((raw as { parses: unknown[] }).parses) : []),
    ui: {
      activeSourceKey: typeof ui.activeSourceKey === 'string' ? ui.activeSourceKey : '',
      activeLiveIndex: clampIndex(typeof ui.activeLiveIndex === 'number' ? ui.activeLiveIndex : 0, lives.length),
    },
    profiles,
    activeProfileId,
    subscriptionGroups,
    // ★ 2026-10-15：用户删除过的源 key 墓碑（见 UserConfig.deletedSourceKeys）
    deletedSourceKeysByProfile,
    globallyBlockedSourceKeys: Array.isArray(raw?.globallyBlockedSourceKeys) ? [...new Set(raw.globallyBlockedSourceKeys.filter(key => typeof key === 'string').map(key => key.trim()).filter(Boolean))] : [],
    deletedSourceKeys: Object.hasOwn(deletedSourceKeysByProfile, activeProfileId) ? deletedSourceKeysByProfile[activeProfileId] : [],
  };
  // active 源若已被剔除/失效 → 清空
  if (next.ui.activeSourceKey && !sources.some((s) => s.key === next.ui.activeSourceKey)) {
    next.ui.activeSourceKey = '';
  }
  return { config: next, diagnostics };
}


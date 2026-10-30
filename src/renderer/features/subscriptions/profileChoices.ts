import type { UserConfig, UserProfile } from '../../../shared/types';

export interface ProfileChoice { id: string; profileId?: string; name: string; groupName: string; sourceCount: number; liveCount: number; reason: string; restorable: boolean }

function snapshotCounts(profile: UserProfile, deletedKeys: ReadonlySet<string>): { sourceCount: number; liveCount: number; restorable: boolean } {
  try {
    const raw: unknown = JSON.parse(profile.json);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { sourceCount: profile.sourceCount, liveCount: 0, restorable: false };
    const value = raw as Record<string, unknown>;
    const sites = Array.isArray(value.sites) ? value.sites : null;
    const sourceCount = sites
      ? sites.filter((site) => !site || typeof site !== 'object' || !('key' in site) || !deletedKeys.has(String((site as { key: unknown }).key))).length
      : profile.sourceCount;
    return { sourceCount, liveCount: Array.isArray(value.lives) ? value.lives.length : 0, restorable: sites !== null || Array.isArray(value.lives) };
  } catch { return { sourceCount: profile.sourceCount, liveCount: 0, restorable: false }; }
}

export function profileChoices(config: UserConfig): ProfileChoice[] {
  const result: ProfileChoice[] = config.profiles.flatMap(profile => {
    const group = config.subscriptionGroups.find(item => item.members.some(member => member.profileId === profile.id));
    const member = group?.members.find(item => item.profileId === profile.id);
    const legacyDeletedKeys = profile.id === config.activeProfileId ? config.deletedSourceKeys ?? [] : [];
    const deletedKeys = new Set([...(config.deletedSourceKeysByProfile?.[profile.id] ?? legacyDeletedKeys)]);
    const counts = snapshotCounts(profile, deletedKeys);
    if (!counts.restorable) return [];
    return [{ id: profile.id, profileId: profile.id, name: profile.name, groupName: group?.name ?? '独立配置', ...counts, reason: member?.status === 'failed' ? '刷新失败，可使用已保存配置' : '' }];
  });
  return result;
}

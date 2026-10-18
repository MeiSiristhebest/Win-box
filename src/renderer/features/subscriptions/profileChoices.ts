import type { UserConfig, UserProfile } from '../../../shared/types';

export interface ProfileChoice { id: string; profileId?: string; name: string; groupName: string; sourceCount: number; liveCount: number; reason: string; restorable: boolean }

function snapshotCounts(profile: UserProfile): { liveCount: number; restorable: boolean } {
  try {
    const raw: unknown = JSON.parse(profile.json);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { liveCount: 0, restorable: false };
    const value = raw as Record<string, unknown>;
    return { liveCount: Array.isArray(value.lives) ? value.lives.length : 0, restorable: Array.isArray(value.sites) || Array.isArray(value.lives) };
  } catch { return { liveCount: 0, restorable: false }; }
}

function unavailableReason(error?: string): string {
  if (!error) return '没有可用的已保存配置';
  const http = /HTTP\s+(\d{3})/.exec(error);
  if (http) return '导入失败：HTTP ' + http[1] + '，暂无已保存配置';
  if (/timeout|timed out|超时/i.test(error)) return '导入超时，暂无已保存配置';
  if (/certificate|证书/i.test(error)) return '证书验证失败，暂无已保存配置';
  if (/html|网页/i.test(error)) return '地址返回了网页，暂无已保存配置';
  return '导入失败，暂无已保存配置；可在配置档案中查看原因';
}

export function profileChoices(config: UserConfig): ProfileChoice[] {
  const result: ProfileChoice[] = config.profiles.map(profile => {
    const group = config.subscriptionGroups.find(item => item.members.some(member => member.profileId === profile.id));
    const member = group?.members.find(item => item.profileId === profile.id);
    const counts = snapshotCounts(profile);
    return { id: profile.id, profileId: profile.id, name: profile.name, groupName: group?.name ?? '独立配置', sourceCount: profile.sourceCount, ...counts, reason: counts.restorable ? member?.status === 'failed' ? '刷新失败，可使用已保存配置' : '' : '没有可恢复的配置，请重新导入' };
  });
  for (const group of config.subscriptionGroups) {
    for (const member of group.members) {
      if (member.profileId && config.profiles.some(profile => profile.id === member.profileId)) continue;
      result.push({ id: group.id + ':' + member.id, name: member.name, groupName: group.name, sourceCount: 0, liveCount: 0, restorable: false, reason: member.status === 'pending' ? '尚未导入完成' : unavailableReason(member.error) });
    }
  }
  return result;
}

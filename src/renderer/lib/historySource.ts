// 历史记录所属订阅/源的匹配。
// 历史不能只保存 sourceKey：切换订阅后必须先恢复正确的订阅档案。
import type { ProfileSitesView } from '../../shared/types';

export interface HistorySourceRef {
  sourceKey?: string;
  sourceName?: string;
  profileId?: string;
}

export interface HistorySourceMatch {
  profileId: string;
  profileName: string;
  key: string;
  name: string;
}

/** 新记录优先使用 profileId；旧记录没有 profileId 时按源 key/name 反查。 */
export function findHistorySource(view: ProfileSitesView, ref: HistorySourceRef): HistorySourceMatch | null {
  const key = (ref.sourceKey || '').trim();
  const name = (ref.sourceName || '').trim();
  const pid = (ref.profileId || '').trim();
  if (!key && !name) return null;

  const candidates: Array<HistorySourceMatch & { score: number }> = [];
  const knownProfile = pid && view.profiles.some((p) => p.id === pid);
  for (const profile of view.profiles || []) {
    if (knownProfile && profile.id !== pid) continue;
    for (const site of profile.sites || []) {
      const siteKey = (site.key || '').trim();
      const siteName = (site.name || siteKey).trim();
      // 旧历史的 sourceName 曾被错误地写成影片名；只要 sourceKey 唯一仍应可恢复。
      // 当同一 key 出现在多个订阅时，下面的 sourceName 加分负责消歧。
      if ((!key || siteKey !== key) && (!name || siteName !== name)) continue;
      let score = 0;
      if (pid && profile.id === pid) score += 1000;
      if (key && siteKey === key) score += 100;
      if (name && siteName === name) score += 50;
      if (!pid && profile.id === view.activeId) score += 1;
      candidates.push({ profileId: profile.id, profileName: profile.name, key: siteKey, name: siteName, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const hit = candidates[0];
  return hit ? { profileId: hit.profileId, profileName: hit.profileName, key: hit.key, name: hit.name } : null;
}

export interface HistorySourceClient {
  cfgGet(): Promise<{ activeProfileId: string; sources: Array<{ key: string; name: string }> }>;
  cfgProfileSites(): Promise<ProfileSitesView>;
  cfgSwitchProfileSource(profileId: string, key: string): Promise<void>;
}

export type HistorySourceLookupClient = Pick<HistorySourceClient, 'cfgGet' | 'cfgProfileSites'>;

async function loadHistorySourceMatch(api: HistorySourceLookupClient, ref: HistorySourceRef): Promise<{ activeProfileId: string; match: HistorySourceMatch }> {
  const [cfg, view] = await Promise.all([api.cfgGet(), api.cfgProfileSites()]);
  // 未启用档案管理的手动源列表也参与匹配。
  if (!view.profiles.some((p) => p.id === cfg.activeProfileId)) {
    view.profiles.push({ id: cfg.activeProfileId, name: '当前配置', sites: cfg.sources });
  }
  view.activeId = cfg.activeProfileId;
  const hit = findHistorySource(view, ref);
  if (!hit) throw new Error(`所有已保存订阅中均未找到历史来源「${ref.sourceName || ref.sourceKey || '未知源'}」`);
  return { activeProfileId: cfg.activeProfileId, match: hit };
}

/** 只查找历史来源，不切换全局活动订阅；详情与播放请求可携带返回的 profileId。 */
export async function resolveHistorySource(api: HistorySourceLookupClient, ref: HistorySourceRef): Promise<HistorySourceMatch> {
  return (await loadHistorySourceMatch(api, ref)).match;
}

/** 用户明确要求恢复活动订阅时使用；一般详情与播放流程应直接使用 profileId 隔离。 */
export async function restoreHistorySource(api: HistorySourceClient, ref: HistorySourceRef): Promise<HistorySourceMatch> {
  const { activeProfileId, match } = await loadHistorySourceMatch(api, ref);
  if (match.profileId !== activeProfileId) {
    await api.cfgSwitchProfileSource(match.profileId, match.key);
  }
  return match;
}

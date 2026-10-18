import type { SubscriptionGroup, SubscriptionRefreshResolution, UserProfile } from '../../../shared/types';

interface SubscriptionGroupsSectionProps {
  groups: readonly SubscriptionGroup[];
  profiles: readonly UserProfile[];
  activeProfileId: string;
  busy: boolean;
  importRunning: boolean;
  onRefresh: (url: string, name: string) => void;
  onActivate: (profileId: string) => void;
  onRemoveMember: (groupId: string, memberId: string, name: string) => void;
  onResolveRefresh: (groupId: string, memberId: string, resolution: SubscriptionRefreshResolution) => void;
}

export function SubscriptionGroupsSection({
  groups,
  profiles,
  activeProfileId,
  busy,
  importRunning,
  onRefresh,
  onActivate,
  onRemoveMember,
  onResolveRefresh,
}: SubscriptionGroupsSectionProps) {
  if (groups.length === 0) return null;

  return (
    <section className="card" id="cfg-subscription-groups" style={{ padding: 12, marginBottom: 16 }}>
      <h3 style={{ fontWeight: 600, margin: '0 0 8px' }}>多仓订阅组</h3>
      {groups.map((group) => {
        const ready = group.members.filter((member) => member.status === 'ready').length;
        const failed = group.members.filter((member) => member.status === 'failed').length;
        const pending = group.members.filter((member) => member.status === 'pending' || member.status === 'pending-removal' || member.status === 'needs-review').length;
        return (
          <details key={group.id} style={{ borderTop: '1px solid var(--border)', padding: '8px 0' }}>
            <summary style={{ cursor: 'pointer' }}>
              {group.name} — {group.status === 'complete' ? '完成' : group.status === 'partial' ? '部分完成' : '失败'}；成功 {ready}，失败 {failed}，待处理 {pending}
            </summary>
            <div className="row" style={{ margin: '8px 0', overflowWrap: 'anywhere' }}>
              <span className="muted">{group.url}</span>
              <button disabled={busy || importRunning} onClick={() => onRefresh(group.url, group.name)}>刷新订阅组</button>
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              {group.members.map((member) => {
                const profile = member.profileId ? profiles.find((item) => item.id === member.profileId) : undefined;
                const stateLabel = member.status === 'ready' ? '可用' : member.status === 'failed' ? '失败' : member.status === 'needs-review' ? '待确认刷新' : member.status === 'pending' ? '待处理' : member.status === 'pending-removal' ? '上游已移除' : '待处理';
                const refreshDiff = member.refreshDiff;
                const changedKeys = refreshDiff?.changed.map((change) => `${change.key}（${change.fields.join('、')}）`) ?? [];
                const preview = (items: string[]): string => items.length > 10
                  ? `${items.slice(0, 10).join('、')} 等 ${items.length} 项`
                  : items.join('、') || '无';
                return (
                  <div key={member.id} style={{ display: 'grid', gap: 4 }}>
                    <div className="row" style={{ justifyContent: 'space-between', gap: 8, borderLeft: '2px solid var(--border)', paddingLeft: 8 }}>
                      <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                        {member.name} <span className="muted">{stateLabel}</span>
                        {member.error ? <span className="muted"> — {member.error}</span> : null}
                        {profile ? <span className="muted"> — {profile.sourceCount} 个源</span> : null}
                      </span>
                      {profile && profile.id !== activeProfileId && <button className="linkbtn" disabled={busy || importRunning} onClick={() => onActivate(profile.id)}>切换到此子仓</button>}
                      {member.status === 'pending-removal' && <button className="linkbtn danger" onClick={() => onRemoveMember(group.id, member.id, member.name)}>从组中移除</button>}
                    </div>
                    {refreshDiff ? (
                      <div style={{ marginLeft: 10, fontSize: 12 }}>
                        <details className="muted">
                          <summary style={{ cursor: 'pointer' }}>
                            首次刷新差异（现有配置已保留）：新增 {refreshDiff.addedKeys.length}，移除 {refreshDiff.removedKeys.length}，更新 {refreshDiff.changed.length}
                          </summary>
                          <div>新增源：{preview(refreshDiff.addedKeys)}</div>
                          <div>移除源：{preview(refreshDiff.removedKeys)}</div>
                          <div>更新源：{preview(changedKeys)}</div>
                        </details>
                        {profile ? (
                          <div className="row" style={{ gap: 8, marginTop: 4 }}>
                            <button disabled={busy || importRunning} onClick={() => onResolveRefresh(group.id, member.id, 'keep-current')}>
                              保留手动改动并建立基线
                            </button>
                            <button className="danger" disabled={busy || importRunning} onClick={() => onResolveRefresh(group.id, member.id, 'use-upstream')}>
                              采用上游配置
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </details>
        );
      })}
    </section>
  );
}

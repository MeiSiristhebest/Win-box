import { useEffect, useRef } from 'react';
import type { UserProfile } from '../../../shared/types';
import type { SavedProfilesManagementPort } from './application/savedProfilesManagementPort';
import { useSavedProfilesManagement } from './useSavedProfilesManagement';

interface SavedProfilesSectionProps {
  profiles: readonly UserProfile[];
  activeProfileId: string;
  busy: boolean;
  onActivate: (profileId: string) => void;
  activationError?: string;
  onRefresh: () => Promise<void>;
  managementPort: SavedProfilesManagementPort;
}

export function SavedProfilesSection({
  profiles,
  activeProfileId,
  busy,
  onActivate,
  activationError,
  onRefresh,
  managementPort,
}: SavedProfilesSectionProps) {
  const { model, actions } = useSavedProfilesManagement({ port: managementPort, onRefresh });
  const { profileName, renameId, renameDraft, saving, error } = model;
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renameId) renameInputRef.current?.focus();
  }, [renameId]);

  return (
    <section className="card" id="cfg-profiles" style={{ padding: 12, marginBottom: 16 }}>
      {activationError && <div className="err" role="alert">{activationError}</div>}
      {error && <div className="err" role="alert">{error}</div>}
      <details>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
          已保存配置（多份订阅离线切换）
          {profiles.length > 0 ? <span className="muted" style={{ fontWeight: 400 }}> —— 共 {profiles.length} 份，当前「{profiles.find((profile) => profile.id === activeProfileId)?.name ?? '未知'}」</span> : null}
        </summary>
        <div style={{ marginTop: 10 }}>
          {profiles.length === 0 ? (
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
              暂无档案。从地址/JSON 导入后，或点右侧「存为新配置」，即可在多份订阅源之间离线切换。
            </div>
          ) : (
            <div className="row" style={{ flexWrap: 'wrap', marginBottom: 8 }}>
              {profiles.map((profile) => {
                const active = profile.id === activeProfileId;
                const editing = renameId === profile.id;
                return (
                  <span key={profile.id} className={`tag ${active ? 'active' : ''}`}
                    style={{ padding: '6px 10px', display: 'inline-flex', gap: 6, alignItems: 'center' }}
                    title={profile.json ? `${profile.json.length} 字节可恢复数据` : '该档案由早期版本迁移，无原始数据'}>
                    {editing ? (
                      <>
                        <input
                          ref={renameInputRef}
                          style={{ width: 130, fontSize: 12 }}
                          value={renameDraft}
                          onChange={(event) => actions.changeRenameDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.nativeEvent.isComposing) void actions.saveRename(profile.id);
                            if (event.key === 'Escape') actions.cancelRename();
                          }}
                        />
                        <button className="linkbtn" onClick={() => void actions.saveRename(profile.id)}>确定</button>
                        <button className="linkbtn" onClick={actions.cancelRename}>取消</button>
                      </>
                    ) : (
                      <>
                        {profile.name}{active ? ' ✓' : ''} <span className="muted">({profile.sourceCount})</span>
                        <button className="linkbtn" title="重命名该配置" onClick={() => actions.beginRename(profile.id, profile.name)}>改名</button>
                        {!active && <button className="linkbtn" onClick={() => onActivate(profile.id)}>切换</button>}
                        {<button className="linkbtn danger" onClick={() => void actions.deleteProfile(profile.id)}>删</button>}
                      </>
                    )}
                  </span>
                );
              })}
            </div>
          )}
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <input style={{ width: 220 }} placeholder="把当前源列表存为新配置的名称…" value={profileName} onChange={(event) => actions.changeProfileName(event.target.value)} />
            <button disabled={busy || saving} onClick={() => void actions.saveProfile()}>{saving ? '保存中…' : '存为新配置'}</button>
          </div>
        </div>
      </details>
    </section>
  );
}

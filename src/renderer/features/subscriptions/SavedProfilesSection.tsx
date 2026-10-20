import { useEffect, useRef, useState } from 'react';
import type { UserProfile } from '../../../shared/types';
import { client } from '../../api/client';

interface SavedProfilesSectionProps {
  profiles: readonly UserProfile[];
  activeProfileId: string;
  busy: boolean;
  onActivate: (profileId: string) => void;
  onRefresh: () => Promise<void>;
  onError: (message: string) => void;
}

export function SavedProfilesSection({
  profiles,
  activeProfileId,
  busy,
  onActivate,
  onRefresh,
  onError,
}: SavedProfilesSectionProps) {
  const [profileName, setProfileName] = useState('');
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renameId) renameInputRef.current?.focus();
  }, [renameId]);

  async function saveProfile() {
    setSaving(true);
    try {
      await client.cfgSaveAsProfile(profileName || '未命名配置');
      setProfileName('');
      await onRefresh();
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function saveRename(id: string) {
    const name = renameDraft.trim();
    setRenameId(null);
    setRenameDraft('');
    if (!name) return;
    try {
      await client.cfgUpdateProfileName({ id, name });
      await onRefresh();
    } catch (error) {
      onError((error as Error).message);
    }
  }

  async function deleteProfile(id: string) {
    try {
      await client.cfgDeleteProfile(id);
      await onRefresh();
    } catch (error) {
      onError((error as Error).message);
    }
  }

  return (
    <section className="card" id="cfg-profiles" style={{ padding: 12, marginBottom: 16 }}>
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
                          style={{ width: 130, fontSize: 11 }}
                          value={renameDraft}
                          onChange={(event) => setRenameDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.nativeEvent.isComposing) void saveRename(profile.id);
                            if (event.key === 'Escape') { setRenameId(null); setRenameDraft(''); }
                          }}
                        />
                        <button className="linkbtn" onClick={() => void saveRename(profile.id)}>确定</button>
                        <button className="linkbtn" onClick={() => { setRenameId(null); setRenameDraft(''); }}>取消</button>
                      </>
                    ) : (
                      <>
                        {profile.name}{active ? ' ✓' : ''} <span className="muted">({profile.sourceCount})</span>
                        <button className="linkbtn" title="重命名该配置" onClick={() => { setRenameId(profile.id); setRenameDraft(profile.name); }}>改名</button>
                        {!active && <button className="linkbtn" onClick={() => onActivate(profile.id)}>切换</button>}
                        {<button className="linkbtn danger" onClick={() => void deleteProfile(profile.id)}>删</button>}
                      </>
                    )}
                  </span>
                );
              })}
            </div>
          )}
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <input style={{ width: 220 }} placeholder="把当前源列表存为新配置的名称…" value={profileName} onChange={(event) => setProfileName(event.target.value)} />
            <button disabled={busy || saving} onClick={() => void saveProfile()}>{saving ? '保存中…' : '存为新配置'}</button>
          </div>
        </div>
      </details>
    </section>
  );
}

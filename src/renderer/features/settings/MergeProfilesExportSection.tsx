import type { UserConfig } from '../../../shared/types';

interface MergeProfileExportMessage {
  text: string;
  kind: 'ok' | 'err';
}

interface MergeProfilesExportSectionProps {
  profiles: UserConfig['profiles'];
  selectedProfileIds: ReadonlySet<string>;
  message: MergeProfileExportMessage | null;
  onToggleProfile: (profileId: string) => void;
  onExport: () => void;
}

/** Passive profile selection and merge-export view. */
export function MergeProfilesExportSection({
  profiles,
  selectedProfileIds,
  message,
  onToggleProfile,
  onExport,
}: MergeProfilesExportSectionProps) {
  return (
    <section className="card" id="cfg-merge" style={{ padding: 12, marginBottom: 16 }} aria-labelledby="cfg-merge-title">
      <div className="row" style={{ marginBottom: 6 }}>
        <h3 id="cfg-merge-title" className="muted" style={{ fontWeight: 600, margin: 0 }}>合并导出（把多份配置的源合并去重成一份订阅 JSON）</h3>
        <button className="primary" disabled={!selectedProfileIds.size} onClick={onExport}>合并并另存为…</button>
      </div>
      {profiles.length > 0 ? (
        <div className="row" style={{ flexWrap: 'wrap', marginBottom: 4 }}>
          {profiles.map((profile) => {
            const checked = selectedProfileIds.has(profile.id);
            return (
              <label key={profile.id} className={`tag ${checked ? 'active' : ''}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  style={{ accentColor: 'var(--accent)', margin: 0 }}
                  checked={checked}
                  onChange={() => onToggleProfile(profile.id)}
                />
                {profile.name} <span className="muted">({profile.sourceCount})</span>
                {!profile.json && <span className="muted" title="该档案来自早期版本，无原始数据可合并">· 无数据</span>}
              </label>
            );
          })}
        </div>
      ) : (
        <div className="muted" style={{ fontSize: 12 }}>没有可合并的档案——先在上方「已保存配置」里存下至少两份配置。</div>
      )}
      {message && (
        <div role={message.kind === 'err' ? 'alert' : 'status'} style={{ marginTop: 6, fontSize: 12, color: message.kind === 'ok' ? 'var(--text-success)' : 'var(--text-danger)', wordBreak: 'break-all' }}>
          {message.text}
        </div>
      )}
    </section>
  );
}

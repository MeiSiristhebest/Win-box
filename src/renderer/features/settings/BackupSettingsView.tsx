import type { BackupSettingsViewModel } from './useBackupSettingsPresenter';

interface BackupSettingsViewProps {
  model: BackupSettingsViewModel;
  onExport(): void;
  onImport(): void;
}

export function BackupSettingsView({ model, onExport, onImport }: BackupSettingsViewProps) {
  return (
    <div className="card" style={{ padding: 12, marginBottom: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          备份内容：订阅源与档案、网盘 Cookie、字幕与 TMDB 凭据、弹幕与播放偏好、代理、快捷键、外观、观看历史与收藏。
        </span>
        <span className="muted" style={{ fontSize: 12 }}>
          凭据（网盘 Cookie 和接口密钥）会以明文写入备份文件。请妥善保管文件。
        </span>
        <div className="row" style={{ alignItems: 'center', gap: 10 }}>
          <button className="primary" disabled={model.busy} onClick={() => { void onExport(); }}>导出设置备份</button>
          <button disabled={model.busy} onClick={() => { void onImport(); }}>导入设置备份</button>
          {model.feedback && (
            <span className={model.feedback.kind === 'err' ? 'err' : 'status'} style={{ margin: 0 }} aria-live="polite">
              {model.feedback.text}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

import type { BossKeyStroke } from './application/bossKeyAccelerator';
import type { ShortcutSettingsActions, ShortcutSettingsViewModel } from './useShortcutSettingsPresenter';

export function ShortcutSettingsView({ model, actions }: { model: ShortcutSettingsViewModel; actions: ShortcutSettingsActions }) {
  if (model.loading) return <div className="card" id="cfg-shortcut" style={{ padding: 12, marginBottom: 16 }}><div className="empty"><span className="spinner" aria-hidden="true" />加载中…</div></div>;
  if (!model.bossKey) return null;

  return (
    <div className="card" id="cfg-shortcut" style={{ padding: 12, marginBottom: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="row" style={{ alignItems: 'center', gap: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={model.bossKey.enabled} onChange={(event) => actions.onToggleEnabled(event.target.checked)} />
            <span style={{ fontWeight: 600 }}>启用老板键</span>
          </label>
          <span className="muted" style={{ fontSize: 12 }}>
            当前：{model.bossKey.enabled ? model.acceleratorDisplay : '未启用'}
          </span>
        </div>
        <div className="row" style={{ alignItems: 'center', gap: 8 }}>
          <span className="muted" style={{ fontSize: 12, flex: 'none' }}>快捷键：</span>
          <input
            aria-label="全局快捷键"
            style={{ width: 220, fontFamily: 'monospace' }}
            value={model.acceleratorDisplay}
            placeholder="按 Ctrl + Shift + B 等组合"
            readOnly
            onKeyDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const stroke: BossKeyStroke = {
                key: event.key,
                control: event.ctrlKey,
                meta: event.metaKey,
                alt: event.altKey,
                shift: event.shiftKey,
              };
              actions.onCaptureAccelerator(stroke);
            }}
          />
          <span className="muted" style={{ fontSize: 12 }}>点击输入框后按下快捷键组合</span>
        </div>
        <div className="muted" style={{ fontSize: 12, lineHeight: 1.7 }}>
          按下快捷键后，视频暂停并静音，软件最小化并隐藏任务栏图标。再次按下可恢复播放状态和窗口模式。快捷键在软件未获焦点时也能使用。
        </div>
        <div className="row" style={{ alignItems: 'center', gap: 10 }}>
          <button className="primary" disabled={model.saving} onClick={actions.onSave}>{model.saving ? '保存中…' : '保存老板键'}</button>
          {model.bossKey.enabled && model.acceleratorDraft && (
            <button disabled={model.saving} onClick={actions.onCancelDraft}>取消修改</button>
          )}
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

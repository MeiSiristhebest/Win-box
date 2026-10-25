import type {
  PlaybackCompatibilityViewActions,
  PlaybackCompatibilityViewModel,
} from './playbackCompatibilityViewModel';

interface PlaybackCompatibilitySettingsViewProps {
  model: PlaybackCompatibilityViewModel;
  actions: PlaybackCompatibilityViewActions;
}

export function PlaybackCompatibilitySettingsView({ model, actions }: PlaybackCompatibilitySettingsViewProps) {
  return (
    <section id="cfg-mpv-kernel" style={{ marginTop: 16 }}>
      <h4>应用内兼容播放组件</h4>
      <p className="muted" style={{ overflowWrap: 'anywhere' }}>{model.statusLabel}</p>
      <div className="row" style={{ gap: 8 }}>
        <input
          aria-label="兼容播放组件路径"
          placeholder="自定义 mpv.exe 路径（留空使用随包版本）"
          value={model.path}
          disabled={!model.settingsLoaded || model.saving}
          style={{ flex: 1, minWidth: 0 }}
          onChange={event => actions.setPathDraft(event.target.value)}
        />
        <button type="button" disabled={!model.settingsLoaded || model.saving} onClick={() => void actions.savePath()}>
          {model.saving ? '正在保存…' : '保存路径'}
        </button>
      </div>
      {model.message && <output className={model.message.kind === 'err' ? 'err' : 'status'} style={{ display: 'block', marginTop: 8 }}>{model.message.text}</output>}
    </section>
  );
}

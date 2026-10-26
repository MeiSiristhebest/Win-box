import type { PlayerEngineView } from '../../../shared/plugin';
import type { PlayerEngineSettingsViewModel } from './usePlayerEngineSettingsPresenter';

interface PlayerEngineSettingsViewProps {
  model: PlayerEngineSettingsViewModel;
  onToggle(item: PlayerEngineView, enabled: boolean): void;
  onPathChange(itemId: string, path: string): void;
  onSavePath(item: PlayerEngineView): void;
}

export function PlayerEngineSettingsView({ model, onToggle, onPathChange, onSavePath }: PlayerEngineSettingsViewProps) {
  return (
    <section className="card" id="cfg-plugin-engines">
      <h3>插件播放内核</h3>
      <p className="muted">启用后可在播放器的内核列表中选用。</p>
      {model.loading && <p className="muted">正在检查可用的插件播放内核…</p>}
      {!model.loading && model.items.length === 0 && <p className="muted">没有可用的插件播放内核。安装提供播放内核的插件后，它们会显示在这里。</p>}
      {!model.loading && model.items.map((item) => (
        <div key={item.id}>
          <label className="row">
            <input
              type="checkbox"
              checked={model.settings.engineEnabled[item.id] === true}
              disabled={model.busy}
              onChange={(event) => onToggle(item, event.target.checked)}
            />
            <span>{item.label}</span>
          </label>
          <p className="muted">{item.pluginName} · {item.ready ? '就绪' : item.note || '未就绪'}</p>
          {item.source === 'local-path' && (
            <div className="row">
              <input
                aria-label={item.label + '程序路径'}
                placeholder="本机程序路径"
                value={model.drafts[item.id] ?? model.settings.enginePaths[item.id] ?? ''}
                disabled={model.busy}
                onChange={(event) => onPathChange(item.id, event.target.value)}
              />
              <button type="button" disabled={model.busy} onClick={() => onSavePath(item)}>保存路径</button>
            </div>
          )}
        </div>
      ))}
      {model.error && <p className="err" role="alert">{model.error}</p>}
    </section>
  );
}

import type { KeymapView } from '../../../shared/plugin';
import type { PluginKeymapListModel } from './usePluginKeymapListPresenter';

export function PluginKeymapListView({ model, onRetry }: { model: PluginKeymapListModel; onRetry(): void }) {
  if (model.status === 'idle') return null;
  return (
    <section className="card" id="cfg-plugin-keymap">
      <h3>插件快捷键</h3>
      {model.status === 'loading' && <span role="status" className="muted">正在加载插件快捷键…</span>}
      {model.status === 'failed' && (
        <div role="alert" className="err">
          <span>插件快捷键加载失败：{model.error || '未知错误'}</span>
          <button type="button" onClick={onRetry}>重试</button>
        </div>
      )}
      {model.status === 'ready' && model.items.length === 0 && <p className="muted">当前没有插件快捷键。</p>}
      {model.items.map((item: KeymapView) => (
        <div key={item.id} className="row">
          <kbd>{item.key}</kbd>
          <span>{item.label}</span>
          <span className="muted">{item.scope.map(scope => scope === 'player' ? '播放器' : '主窗口').join(' / ')} · {item.pluginName}</span>
        </div>
      ))}
    </section>
  );
}

import type { NetworkSettingsViewActions, NetworkSettingsViewModel } from './networkSettingsViewModel';

export function NetworkSettingsView({ model, actions }: { model: NetworkSettingsViewModel; actions: NetworkSettingsViewActions }) {
  return (
    <div className="card" style={{ padding: 12, marginBottom: 16 }}>
      {model.loadState === 'loading' ? (
        <div className="empty"><span className="spinner" aria-hidden="true" />加载代理设置…</div>
      ) : model.loadState === 'error' ? (
        <div className="row" style={{ alignItems: 'center', gap: 10 }}>
          <span className="err" role="alert">{model.message?.text ?? '代理设置读取失败'}</span>
          <button type="button" onClick={actions.retryLoad}>重新读取</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="row" style={{ alignItems: 'center', gap: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={model.enabled} disabled={model.saving} onChange={(event) => actions.setEnabled(event.target.checked)} />
              <span style={{ fontWeight: 600 }}>启用网络代理</span>
            </label>
            <span className="muted" style={{ fontSize: 12 }}>
              当前：{model.enabled && model.url ? model.url : '未启用（直连）'}
            </span>
          </div>
          <div className="row" style={{ alignItems: 'center', gap: 8 }}>
            <span className="muted" style={{ fontSize: 12, flex: 'none' }}>代理地址：</span>
            <input
              style={{ width: 300, fontFamily: 'monospace' }}
              placeholder="http://127.0.0.1:7890"
              value={model.url}
              disabled={model.saving}
              onChange={(event) => actions.setUrl(event.target.value)}
            />
            <span className="muted" style={{ fontSize: 12 }}>http 代理（Clash / V2Ray 等本机代理常见为 7890）</span>
          </div>
          <div className="row" style={{ alignItems: 'center', gap: 10 }}>
            <button type="button" className="primary" disabled={model.saving} onClick={() => void actions.save()}>
              {model.saving ? '正在保存…' : '保存代理'}
            </button>
            {model.message && <output className={model.message.kind === 'err' ? 'err' : 'status'} style={{ margin: 0 }}>{model.message.text}</output>}
          </div>
        </div>
      )}
    </div>
  );
}

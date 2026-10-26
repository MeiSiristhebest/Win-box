import type { SubtitleSettingsViewModel } from './useSubtitleSettingsPresenter';

interface SubtitleSettingsViewProps {
  model: SubtitleSettingsViewModel;
  onTokenChange(token: string): void;
  onSaveToken(): void;
  onToggleProvider(providerId: string): void;
}

export function SubtitleSettingsView({ model, onTokenChange, onSaveToken, onToggleProvider }: SubtitleSettingsViewProps) {
  return (
    <div className="card" id="cfg-subtitle" style={{ padding: 12, marginBottom: 16 }}>
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="muted" style={{ fontWeight: 600 }}>外挂字幕（多源在线检索）</span>
      </div>
      {model.status === 'loading' && <output className="status">正在读取字幕设置…</output>}
      {model.status === 'error' && <div className="err" role="alert">读取字幕设置失败：{model.error}</div>}
      {model.providers.length > 0 && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          {model.providers.map((provider) => (
            <button
              key={provider.id}
              type="button"
              className={'tag' + (provider.enabled ? ' active' : '')}
              title={provider.reason || (provider.enabled ? '点击关闭该字幕源' : '点击启用该字幕源')}
              disabled={Boolean(model.busy)}
              aria-pressed={provider.enabled}
              onClick={() => onToggleProvider(provider.id)}
            >
              {provider.name}{provider.available ? '' : '（不可用）'}
            </button>
          ))}
        </div>
      )}
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <input
          aria-label="字幕服务 Token"
          type="password"
          placeholder="粘贴你的 assrt.net token…"
          value={model.token}
          style={{ flex: 1 }}
          disabled={model.status !== 'ready' || Boolean(model.busy)}
          onChange={(event) => onTokenChange(event.target.value)}
        />
        <button className="primary" type="button" disabled={model.status !== 'ready' || Boolean(model.busy) || !model.token.trim()} onClick={onSaveToken}>
          {model.busy === 'token' ? '保存中…' : '保存'}
        </button>
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }} aria-live="polite">
        {model.tokenSaved ? '已保存' : 'assrt 需到 assrt.net 免费注册后取 token；SubtitleCat 免 token，开箱可用。'}
      </div>
      {model.error && model.status !== 'error' && <div className="err" role="alert">{model.error}</div>}
    </div>
  );
}

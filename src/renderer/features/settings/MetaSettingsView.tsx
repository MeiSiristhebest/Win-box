import type { MetaSettings } from '../../../shared/meta';
import type { MetaSettingsViewModel } from './useMetaSettingsPresenter';

interface MetaSettingsViewProps {
  model: MetaSettingsViewModel;
  onChange(field: keyof MetaSettings, value: string): void;
  onSave(): void;
}

export function MetaSettingsView({ model, onChange, onSave }: MetaSettingsViewProps) {
  return (
    <div className="card" id="cfg-meta" style={{ padding: 12, marginBottom: 16 }}>
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="muted" style={{ fontWeight: 600 }}>元数据（TMDB / 豆瓣）</span>
      </div>
      {!model.loaded && <output className="status">正在读取元数据设置…</output>}
      {model.loadError && <div className="err" role="alert">读取元数据设置失败：{model.loadError}</div>}
      <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 6 }}>
        <input
          aria-label="TMDB API Key"
          type="password"
          placeholder="TMDB API Key 或 v4 令牌（留空 = 不启用 TMDB）…"
          value={model.draft.tmdbApiKey}
          style={{ flex: 1 }}
          disabled={!model.loaded || model.saving}
          onChange={(event) => onChange('tmdbApiKey', event.target.value)}
        />
        <button className="primary" type="button" disabled={!model.loaded || !model.dirty || model.saving} onClick={onSave}>
          {model.saving ? '保存中…' : '保存'}
        </button>
      </div>
      <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 6 }}>
        <input
          aria-label="TMDB API 代理地址"
          placeholder="API 代理地址（留空 = api.themoviedb.org/3）…"
          value={model.draft.tmdbApiBase}
          style={{ flex: 1 }}
          disabled={!model.loaded || model.saving}
          onChange={(event) => onChange('tmdbApiBase', event.target.value)}
        />
        <input
          aria-label="TMDB 图片镜像地址"
          placeholder="图片镜像地址（留空 = image.tmdb.org/t/p/w342）…"
          value={model.draft.tmdbImageBase}
          style={{ flex: 1 }}
          disabled={!model.loaded || model.saving}
          onChange={(event) => onChange('tmdbImageBase', event.target.value)}
        />
      </div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
        发现页默认使用国内榜单，电影热搜来自百度。保存自己的 TMDB 凭据后，发现页与分类改用 TMDB；清空凭据恢复国内榜单。
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
        封面优先级：已配置的 TMDB → 源自带封面 → 豆瓣 → 暂无封面。未配置 TMDB 时直接使用源封面。
        图片搜索仅用于详情页背景图，简介使用源提供的信息。
      </div>
      {model.message && <div className={model.message.kind === 'err' ? 'err' : 'muted'} style={{ fontSize: 12, marginTop: 8 }} aria-live="polite">{model.message.text}</div>}
    </div>
  );
}

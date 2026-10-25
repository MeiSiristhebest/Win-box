import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_META_SETTINGS, type MetaSettings } from '../../../shared/meta';
import type { SubtitleProviderView } from '../../../shared/subtitle';
import { DriveBindingDialog } from '../driveBinding/DriveBindingDialog';
import type { AccountServicesPort } from './application/accountServicesPort';
import type { AccountSettingsEventsPort } from './application/accountSettingsEventsPort';

export function AccountServicesSection({ active, services, events }: { active: boolean; services: AccountServicesPort; events: AccountSettingsEventsPort }) {
  const [driveOpen, setDriveOpen] = useState(false);
  const [subToken, setSubToken] = useState('');
  const [subTokenSaved, setSubTokenSaved] = useState(false);
  const [subProviders, setSubProviders] = useState<SubtitleProviderView[]>([]);
  const [metaDraft, setMetaDraft] = useState<MetaSettings>({ ...DEFAULT_META_SETTINGS });
  const [metaDirty, setMetaDirty] = useState(false);
  const [metaMsg, setMetaMsg] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null);

  const refreshSubProviders = useCallback(() => {
    services.getSubtitleProviders().then(setSubProviders).catch(() => undefined);
  }, [services]);

  useEffect(() => {
    services.getSubtitleSettings().then((settings) => {
      setSubToken(settings.assrtToken || '');
      setSubTokenSaved(!!settings.assrtToken);
    }).catch(() => undefined);
    refreshSubProviders();
  }, [refreshSubProviders, services]);

  useEffect(() => {
    services.getMetaSettings().then((settings) => {
      setMetaDraft({
        tmdbApiKey: settings.tmdbApiKey,
        tmdbApiBase: settings.tmdbApiBase,
        tmdbImageBase: settings.tmdbImageBase,
        metaSource: settings.metaSource,
      });
    }).catch(() => undefined);
  }, [services]);

  const saveMeta = async () => {
    try {
      const settings = await services.setMetaSettings(metaDraft);
      setMetaDraft({
        tmdbApiKey: settings.tmdbApiKey,
        tmdbApiBase: settings.tmdbApiBase,
        tmdbImageBase: settings.tmdbImageBase,
        metaSource: settings.metaSource,
      });
      setMetaDirty(false);
      events.notifyMetaSettingsChanged();
      setMetaMsg({ text: '已保存，立即生效。', kind: 'ok' });
    } catch (error) {
      setMetaMsg({ text: `保存失败：${(error as Error).message}`, kind: 'err' });
    }
  };

  if (!active) return null;

  return (
    <>
      <div className="card" id="cfg-drives" style={{ padding: 12, marginBottom: 16 }}>
        <h2>全局网盘账号</h2><p>登录状态独立保存在本机，跨子仓和站点共享。可在这里统一登录、更新或解绑。</p>
        <button type="button" onClick={() => setDriveOpen(true)}>管理网盘登录状态</button>
      </div>
      {driveOpen && <DriveBindingDialog siteName="所有子仓与站点" onClose={() => setDriveOpen(false)} onSaved={events.notifyDriveAccountsChanged} />}
      <div className="card" id="cfg-subtitle" style={{ padding: 12, marginBottom: 16 }}>
        <div className="row" style={{ marginBottom: 8 }}>
          <span className="muted" style={{ fontWeight: 600 }}>外挂字幕（多源在线检索）</span>
        </div>
        {subProviders.length > 0 && (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            {subProviders.map((provider) => (
              <button
                key={provider.id}
                className={`tag${provider.enabled ? ' active' : ''}`}
                title={provider.reason || (provider.enabled ? '点击关闭该字幕源' : '点击启用该字幕源')}
                onClick={async () => {
                  const next: Record<string, boolean> = {};
                  for (const item of subProviders) next[item.id] = item.enabled;
                  next[provider.id] = !provider.enabled;
                  await services.setSubtitleSettings({ providers: next }).catch(() => undefined);
                  refreshSubProviders();
                }}
              >
                {provider.name}{provider.available ? '' : '（不可用）'}
              </button>
            ))}
          </div>
        )}
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <input
            type="password"
            placeholder="粘贴你的 assrt.net token…"
            value={subToken}
            style={{ flex: 1 }}
            onChange={(event) => { setSubToken(event.target.value); setSubTokenSaved(false); }}
          />
          <button className="primary" disabled={!subToken.trim()} onClick={async () => {
            await services.setSubtitleSettings({ assrtToken: subToken.trim() }).catch(() => undefined);
            setSubTokenSaved(true);
            refreshSubProviders();
          }}>保存</button>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          {subTokenSaved ? '已保存' : 'assrt 需到 assrt.net 免费注册后取 token；SubtitleCat 免 token，开箱可用。'}
        </div>
      </div>

      <div className="card" id="cfg-meta" style={{ padding: 12, marginBottom: 16 }}>
        <div className="row" style={{ marginBottom: 8 }}>
          <span className="muted" style={{ fontWeight: 600 }}>元数据（TMDB / 豆瓣）</span>
        </div>
        <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 6 }}>
          <input
            type="password"
            placeholder="TMDB API Key 或 v4 令牌（留空 = 不启用 TMDB）…"
            value={metaDraft.tmdbApiKey}
            style={{ flex: 1 }}
            onChange={(event) => { setMetaDraft({ ...metaDraft, tmdbApiKey: event.target.value }); setMetaDirty(true); }}
          />
          <button className="primary" disabled={!metaDirty} onClick={saveMeta}>保存</button>
        </div>
        <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 6 }}>
          <input
            placeholder="API 代理地址（留空 = api.themoviedb.org/3）…"
            value={metaDraft.tmdbApiBase}
            style={{ flex: 1 }}
            onChange={(event) => { setMetaDraft({ ...metaDraft, tmdbApiBase: event.target.value }); setMetaDirty(true); }}
          />
          <input
            placeholder="图片镜像地址（留空 = image.tmdb.org/t/p/w342）…"
            value={metaDraft.tmdbImageBase}
            style={{ flex: 1 }}
            onChange={(event) => { setMetaDraft({ ...metaDraft, tmdbImageBase: event.target.value }); setMetaDirty(true); }}
          />
        </div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          发现页默认使用国内榜单，电影热搜来自百度。保存自己的 TMDB 凭据后，发现页与分类改用 TMDB；清空凭据恢复国内榜单。
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          封面优先级：已配置的 TMDB → 源自带封面 → 豆瓣 → 暂无封面。未配置 TMDB 时直接使用源封面。
          图片搜索仅用于详情页背景图，简介使用源提供的信息。
        </div>
        <div className={metaMsg?.kind === 'err' ? 'err' : 'muted'} style={{ fontSize: 12, marginTop: 8 }} aria-live="polite">
          {metaMsg?.text}
        </div>
      </div>
    </>
  );
}

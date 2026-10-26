import PosterSizeControl from '../../components/PosterSizeControl';
import PluginSlot from '../../components/PluginSlot';
import { Button } from '../../components/ui/Button';
import { DriveBindingDialog } from '../driveBinding/DriveBindingDialog';
import { HomeBrowseResultsView } from './HomeBrowseResultsView';
import { HomeSearchResultsView } from './HomeSearchResultsView';
import type { HomePageViewModel } from './homePageViewModel';

export function HomePageView({ model }: { model: HomePageViewModel }) {
  const { heading, search, source, browse } = model;

  return (
    <>
      {search.showToolbar && (
        <div className="topbar">
          {search.folder ? (
            <button onClick={search.onReturnFromFolder}>← 返回搜索</button>
          ) : (
            <button onClick={search.onReturnToBrowse}>返回浏览</button>
          )}
          <output className="aggregate-topbar-status" aria-live="polite">
            {search.topbarStatus}
          </output>
        </div>
      )}
      <div className="content home-content">
        {!heading.aggregate && (
          <header className="page-heading">
            <div><h1>点播</h1><p>{heading.browseSubtitle}</p></div>
            <PosterSizeControl />
          </header>
        )}
        {heading.aggregate && (
          <header className="page-heading aggregate-page-heading">
            <div><h1>{heading.title}</h1><p>{heading.subtitle}</p></div>
            <PosterSizeControl />
          </header>
        )}
        <PluginSlot slot="home" />
        {model.route.searchWindow && model.route.pathname === '/search' && search.folder && (
          <button style={{ marginBottom: 12 }} onClick={search.onReturnFromFolder}>← 返回搜索结果</button>
        )}
        {source.error && <div className="err" style={{ marginBottom: 10 }}>{source.error}</div>}
        {source.driveBinding.required && !search.active && (
          <div
            className="banner"
            style={{ borderLeftColor: source.driveBinding.boundNames.length ? 'var(--accent-2)' : 'var(--warn)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}
          >
            <span>
              该源用网盘取流：
              {source.driveBinding.boundNames.length ? '全局已配置「' + source.driveBinding.boundNames.join('/') + '」' : '尚未配置所需网盘账号'}。
              账号由本机独立保存，各子仓中兼容的源可以共用。
            </span>
            <Button variant="primary" onClick={source.driveBinding.openDialog}>管理全局网盘账号</Button>
          </div>
        )}
        {source.homePageUrl && !search.active && (
          <div
            className="banner"
            style={{ borderLeftColor: 'var(--accent-2)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}
          >
            <span>该源是网页源（自带网页界面）：列取/登录等交互在网页窗口里完成，起播仍由本应用接管。</span>
            <Button variant="primary" disabled={source.openingWebSource} onClick={() => void source.openWebHome()}>
              {source.openingWebSource ? '正在打开…' : '打开网页'}
            </Button>
            {source.webSourceError && <span className="err" role="alert">{source.webSourceError}</span>}
          </div>
        )}

        {model.profileScope.visible && (
          <fieldset className="aggregate-scope">
            <legend>搜索范围</legend>
            <label className="aggregate-scope-control">
              <input
                type="checkbox"
                checked={model.profileScope.checked}
                disabled={model.profileScope.disabled}
                onChange={event => model.profileScope.onChange(event.target.checked)}
              />
              <span>搜索所有子仓</span>
              <span className="muted">{model.profileScope.count} 个子仓</span>
            </label>
            <p>关闭后只搜索当前子仓；结果会标出所属子仓和来源。</p>
          </fieldset>
        )}

        {search.active ? (
          search.results !== null && !search.error ? (
            <HomeSearchResultsView {...search.results} />
          ) : (
            <div className="empty">
              {search.loading ? <><span className="spinner" aria-hidden="true" />{search.emptyStatus}</> : search.emptyStatus}
            </div>
          )
        ) : (
          <HomeBrowseResultsView {...browse} />
        )}
      </div>
      {model.backToTop.visible && (
        <button className="btn-to-top" title="回到顶部" aria-label="回到顶部" onClick={model.backToTop.onClick}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      )}
      {source.driveBinding.dialogOpen && source.currentSite && (
        <DriveBindingDialog
          siteName={source.currentSite.name || source.currentSite.key}
          onClose={source.driveBinding.closeDialog}
          onSaved={source.driveBinding.onSaved}
        />
      )}
    </>
  );
}

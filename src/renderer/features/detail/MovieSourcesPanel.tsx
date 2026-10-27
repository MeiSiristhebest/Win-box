import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AggVodItem } from '../../../shared/types';
import type { SourceComparisonScore } from '../../../engine/vod/sourceComparison';
import { openDetailRoute } from '../../lib/detailWin';
import { useCovers } from '../covers/useCovers';
import { usePageActive } from '../../lib/keepAlive';
import { useMovieSources } from '../discovery/useMovieSources';
import { movieSourceFolderAdapter, movieSourcesSearchAdapter } from '../discovery/adapters/movieSourcesAdapters';
import { loadMovieSourceFolder } from '../discovery/application/movieSourcesUseCases';
import { projectMovieSourceCover, projectMovieSourceDetailQuery, projectMovieSourcesPanelStatus } from '../discovery/application/movieSourcesPanelPresentation';
import { useMovieSourcesPanelPresenter } from '../discovery/useMovieSourcesPanelPresenter';
import { SearchResultFilters } from '../search/SearchResultFilters';
import '../discovery/movie.css';

export function MovieSourcesPanel({ title: name, poster = '' }: { title: string; poster?: string }) {
  const navigate = useNavigate();
  const active = usePageActive();
  const search = useMovieSources(name, active, movieSourcesSearchAdapter);
  const panelPort = useMemo(() => ({
    loadFolder: (item: AggVodItem) => loadMovieSourceFolder(movieSourceFolderAdapter, item),
    openDetail: (item: AggVodItem) => openDetailRoute(
      to => navigate(to),
      item.sourceKey,
      item.id,
      projectMovieSourceDetailQuery(item),
    ),
  }), [navigate]);
  const panel = useMovieSourcesPanelPresenter(search.report, search.query, search.generation, panelPort);
  const panelStatus = projectMovieSourcesPanelStatus({
    searchLoading: search.loading,
    searchError: search.error,
    report: search.report,
    resultCount: panel.view.items.length,
    folderActive: panel.folderTarget !== null,
    folderLoading: panel.folderLoading,
    folderError: panel.folderError,
    folderErrorKind: panel.folderErrorKind,
    folderItemCount: panel.folder?.items.length ?? 0,
  });
  const coverItem = useCallback((item: AggVodItem) => projectMovieSourceCover(item, search.query, poster), [search.query, poster]);
  const covers = useCovers(panel.visibleItems.map(coverItem), active, true);
  const openRef = useRef(panel.openItem);
  const imageErrorRef = useRef((item: AggVodItem, image: HTMLImageElement) => covers.onError(coverItem(item), image.getAttribute('src') || ''));
  useEffect(() => {
    openRef.current = panel.openItem;
    imageErrorRef.current = (item, image) => covers.onError(coverItem(item), image.getAttribute('src') || '');
  });
  const onOpen = useCallback((item: AggVodItem) => { void openRef.current(item); }, []);
  const onImageError = useCallback((item: AggVodItem, image: HTMLImageElement) => imageErrorRef.current(item, image), []);
  return <section className="movie-sources" aria-label="聚合播放来源" aria-busy={search.loading || panel.folderLoading}>
    <header className="page-heading">
      <div><h2>播放来源</h2><p>在全部已导入子仓中查找“{search.query}”，选择片源后查看剧集并播放。</p></div>
      <button type="button" onClick={() => { panel.resetForSearch(); search.refresh(); }} disabled={search.loading}>重新搜索</button>
    </header>
    {panelStatus.kind === 'searching' && <output>{search.progress ? `正在搜索 ${search.progress.done}/${search.progress.total} 个源…` : panelStatus.message}</output>}
    {(panelStatus.kind === 'search-error' || panelStatus.kind === 'partial-error' || panelStatus.kind === 'folder-error' || panelStatus.kind === 'detail-error') && <div role="alert" className="err"><span>{panelStatus.message}</span>{(panelStatus.kind === 'search-error' || panelStatus.kind === 'partial-error') && <button type="button" onClick={() => { panel.resetForSearch(); search.refresh(); }}>{panelStatus.retryLabel}</button>}{panelStatus.kind === 'folder-error' && <button type="button" onClick={panel.retryFolder}>{panelStatus.retryLabel}</button>}</div>}
    {panel.folderTarget && <div className="row"><button type="button" onClick={panel.backToResults}>返回全部片源</button><span>{panel.folder?.name ?? panel.folderTarget.name}</span></div>}
    {!panel.folder && <>
      <SearchResultFilters profiles={panel.view.profiles} sources={panel.view.sources} profileId={panel.profileId} sourceId={panel.sourceId} mode={panel.mode} hiddenCount={panel.view.hiddenCount}
        onProfile={panel.selectProfile} onSource={panel.selectSource} onMode={panel.selectMode} />
      {search.report && <p className="muted">已检查 {search.report.perSource.length} 个源 · {panel.hitSourceCount} 个源命中 · 显示 {panel.view.items.length} 条{search.report.pendingSources ? ` · ${search.report.pendingSources} 个源正在准备运行时，将自动重试` : ''}</p>}
    </>}
    <div className="grid movie-source-grid">{panel.visibleItems.map(item => {
      const itemKey = JSON.stringify([item.sourceRef?.profileId, item.sourceKey, item.id]);
      return <MovieSourceCard key={itemKey} item={item} comparison={panel.comparisonByItem.get(itemKey)} pic={covers.picOf(coverItem(item))} disabled={panel.folderLoading} onOpen={onOpen} onImageError={onImageError} />;
    })}</div>
    {panel.sourceItems.length > panel.visibleItems.length && <button type="button" onClick={panel.showMore}>显示更多片源（还有 {panel.sourceItems.length - panel.visibleItems.length} 条）</button>}
    {(panelStatus.kind === 'empty' || panelStatus.kind === 'folder-empty') && <p className="empty">{panelStatus.message}</p>}
    {!!search.report?.perSource.length && <details onToggle={event => panel.toggleSourceStates(event.currentTarget.open)}><summary>查看各源搜索状态</summary>{panel.showStates && search.report.perSource.map(source => <p key={JSON.stringify([source.profileId, source.key])}>{source.profileName} / {source.name}：{source.status === 'error' ? source.error : source.count ? `返回 ${source.count} 条` : '本次无返回结果'}</p>)}</details>}
  </section>;
}

const MovieSourceCard = memo(function MovieSourceCard({ item, comparison, pic, disabled, onOpen, onImageError }: {
  item: AggVodItem; comparison?: SourceComparisonScore; pic: string; disabled: boolean; onOpen: (item: AggVodItem) => void; onImageError: (item: AggVodItem, image: HTMLImageElement) => void;
}) {
  const source = [item.sourceProfileName, item.sourceName || item.sourceKey].filter(Boolean).join(' / ');
  const isTop = comparison?.isTopRecommended;
  const clarity = comparison?.clarityTag;
  const latency = comparison?.latencyMs;

  return <button type="button" className={`card-media ui-action card-media-button movie-source-option ${isTop ? 'movie-source-top' : ''}`} aria-label={`${item.name}，${source}，${item.tag === 'folder' ? '浏览网盘目录' : '查看剧集与播放'}`} disabled={disabled} onClick={() => onOpen(item)}>
    <div className="card">
      <div className="media-poster">
        {pic ? <img src={pic} alt={item.name} loading="lazy" decoding="async" onError={event => onImageError(item, event.currentTarget)} /> : <div className="no-cover">{item.tag === 'folder' ? '网盘目录' : '暂无封面'}</div>}
        {isTop ? <span className="badge badge-top-source">★ 推荐首选</span> : (item.remarks || item.tag === 'folder') && <span className="badge">{item.tag === 'folder' ? '目录' : item.remarks}</span>}
      </div>
      <div className="meta">
        <div className="name" title={item.name}>{item.name}</div>
        <div className="movie-source-facts">
          {[item.year, item.type].filter(Boolean).join(' · ')}
          {clarity && <span className="fact-clarity-tag">{clarity}</span>}
          {typeof latency === 'number' && latency > 0 && (
            <span className={`fact-ping-tag ${latency <= 500 ? 'fast' : latency <= 1000 ? 'normal' : 'slow'}`} title={`源响应延迟：${latency}ms`}>
              ⚡ {latency}ms
            </span>
          )}
        </div>
        <div className="movie-source-origin" title={`来源：${source}`}><span className="movie-source-origin-label">来源</span><span>{source}</span></div>
      </div>
    </div>
  </button>;
});

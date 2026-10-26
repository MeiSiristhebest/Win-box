import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AggVodItem } from '../../../shared/types';
import { sourceIdentityKey } from '../../../shared/sourceIdentity';
import { movieSearchTitle, searchTitleScore, type SearchMatchMode } from '../../../shared/searchTitleMatching';
import { projectSearchResults } from '../search/application/searchResultProjection';
import { rankSourcesWithComparison, type SourceComparisonScore } from '../../../engine/vod/sourceComparison';
import { openDetailRoute } from '../../lib/detailWin';
import { useCovers } from '../covers/useCovers';
import { usePageActive } from '../../lib/keepAlive';
import { useMovieSources } from '../discovery/useMovieSources';
import { movieSourceFolderAdapter, movieSourcesSearchAdapter } from '../discovery/adapters/movieSourcesAdapters';
import { loadMovieSourceFolder } from '../discovery/application/movieSourcesUseCases';
import { SearchResultFilters } from '../search/SearchResultFilters';
import '../discovery/movie.css';

export function MovieSourcesPanel({ title: name, poster = '' }: { title: string; poster?: string }) {
  const navigate = useNavigate();
  const active = usePageActive();
  const { report, progress, loading, error, refresh, query } = useMovieSources(name, active, movieSourcesSearchAdapter);
  const [cap, setCap] = useState(60);
  const [profileId, setProfileId] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [mode, setMode] = useState<SearchMatchMode>('related');
  const [folder, setFolder] = useState<{ name: string; items: AggVodItem[] } | null>(null);
  const [folderError, setFolderError] = useState('');
  const [folderLoading, setFolderLoading] = useState(false);
  const [showStates, setShowStates] = useState(false);
  const folderRequest = useRef(0);
  const view = useMemo(() => projectSearchResults(report?.items ?? [], query, { mode, profileId, sourceId }), [report, query, mode, profileId, sourceId]);
  const comparisonMap = useMemo(() => {
    const ranked = rankSourcesWithComparison(view.items, report?.perSource ?? []);
    const map = new Map<string, SourceComparisonScore>();
    for (const entry of ranked) {
      map.set(JSON.stringify([entry.item.sourceRef?.profileId, entry.item.sourceKey, entry.item.id]), entry.comparison);
    }
    return map;
  }, [view.items, report?.perSource]);
  const sourceItems = folder?.items ?? view.items;
  const visibleItems = sourceItems.slice(0, cap);
  const coverItem = (item: AggVodItem) => ({
    id: JSON.stringify([item.sourceRef?.profileId, item.sourceKey, item.id]),
    name: item.tag === 'folder' ? query : movieSearchTitle(item.name),
    year: item.year,
    pic: item.pic || ((item.tag === 'folder' || searchTitleScore(query, item.name) > 0) ? poster : ''),
  });
  const covers = useCovers(visibleItems.map(coverItem), active, true);

  async function open(item: AggVodItem) {
    setFolderError('');
    if (item.tag !== 'folder') {
      const params = new URLSearchParams({ name: item.name, pic: item.pic || '' });
      if (item.sourceRef?.profileId) params.set('profileId', item.sourceRef.profileId);
      try { await openDetailRoute(to => navigate(to), item.sourceKey, item.id, params.toString()); }
      catch (cause) { setFolderError(cause instanceof Error ? cause.message : String(cause)); }
      return;
    }
    const request = ++folderRequest.current;
    setFolderLoading(true);
    try {
      const items = await loadMovieSourceFolder(movieSourceFolderAdapter, item);
      if (request === folderRequest.current) {
        setFolder({ name: item.name, items });
        setCap(60);
      }
    } catch (cause) { if (request === folderRequest.current) setFolderError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (request === folderRequest.current) setFolderLoading(false); }
  }
  const openRef = useRef(open);
  const imageErrorRef = useRef((item: AggVodItem, image: HTMLImageElement) => covers.onError(coverItem(item), image.getAttribute('src') || ''));
  useEffect(() => {
    openRef.current = open;
    imageErrorRef.current = (item, image) => covers.onError(coverItem(item), image.getAttribute('src') || '');
  });
  useEffect(() => () => { folderRequest.current++; }, []);
  const onOpen = useCallback((item: AggVodItem) => { void openRef.current(item); }, []);
  const onImageError = useCallback((item: AggVodItem, image: HTMLImageElement) => imageErrorRef.current(item, image), []);
  const hitSources = new Set(view.items.map(item => sourceIdentityKey(item.sourceRef?.profileId, item.sourceKey))).size;
  return <section className="movie-sources" aria-label="聚合播放来源" aria-busy={loading || folderLoading}>
    <header className="page-heading">
      <div><h2>播放来源</h2><p>在全部已导入子仓中查找“{query}”，选择片源后查看剧集并播放。</p></div>
      <button type="button" onClick={refresh} disabled={loading}>重新搜索</button>
    </header>
    {loading && <output>{progress ? `正在搜索 ${progress.done}/${progress.total} 个源…` : '正在查找全部片源…'}</output>}
    {error && <div role="alert" className="err">{error}</div>}
    {folderError && <div role="alert" className="err">{folderError}</div>}
    {folder ? <div className="row"><button type="button" onClick={() => { folderRequest.current++; setFolder(null); setFolderLoading(false); setFolderError(''); setCap(60); }}>返回全部片源</button><span>{folder.name}</span></div> : <>
      <SearchResultFilters profiles={view.profiles} sources={view.sources} profileId={profileId} sourceId={sourceId} mode={mode} hiddenCount={view.hiddenCount}
        onProfile={id => { setProfileId(id); setSourceId(''); setCap(60); }} onSource={id => { setSourceId(id); setCap(60); }} onMode={value => { setMode(value); setCap(60); }} />
      {report && <p className="muted">已检查 {report.perSource.length} 个源 · {hitSources} 个源命中 · 显示 {view.items.length} 条{report.pendingSources ? ` · ${report.pendingSources} 个源正在准备运行时，将自动重试` : ''}</p>}
    </>}
    <div className="grid movie-source-grid">{visibleItems.map(item => {
      const itemKey = JSON.stringify([item.sourceRef?.profileId, item.sourceKey, item.id]);
      return <MovieSourceCard key={itemKey} item={item} comparison={comparisonMap.get(itemKey)} pic={covers.picOf(coverItem(item))} disabled={folderLoading} onOpen={onOpen} onImageError={onImageError} />;
    })}</div>
    {sourceItems.length > cap && <button type="button" onClick={() => setCap(value => value + 60)}>显示更多片源（还有 {sourceItems.length - cap} 条）</button>}
    {!loading && !folderLoading && !error && sourceItems.length === 0 && <p className="empty">{folder ? '目录暂未返回条目。' : '当前筛选下没有匹配片源，可以更换来源或匹配方式。'}</p>}
    {!!report?.perSource.length && <details onToggle={event => setShowStates(event.currentTarget.open)}><summary>查看各源搜索状态</summary>{showStates && report.perSource.map(source => <p key={JSON.stringify([source.profileId, source.key])}>{source.profileName} / {source.name}：{source.status === 'error' ? source.error : source.count ? `返回 ${source.count} 条` : '本次无返回结果'}</p>)}</details>}
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

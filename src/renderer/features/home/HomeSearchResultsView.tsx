import { memo } from 'react';
import type { AggVodItem, SearchAllReport } from '../../../shared/types';
import { sourceIdentityKey } from '../../../shared/sourceIdentity';
import { SearchResultFilters } from '../search/SearchResultFilters';
import { HomeMediaCardView } from './HomeMediaCardView';
import { formatSearchCacheTime } from './homePageModel';
import type { HomeSearchResultsModel, HomeSearchScope } from './homePageViewModel';

/** Search results are a passive projection: search policy and navigation stay in the page/controller. */
export function HomeSearchResultsView({
  report,
  view,
  folder,
  loading,
  scope,
  defaultProfileId,
  progress,
  query,
  sourceFilter,
  profileFilter,
  matchMode,
  visibleLimit,
  picOf,
  onImageError,
  onOpenItem,
  onRetry,
  onProfileFilter,
  onSourceFilter,
  onMatchMode,
  onShowMore,
}: HomeSearchResultsModel) {
  const wideSearch = scope === 'all' || scope === 'all-profiles';
  const pendingSources = report.pendingSources ?? 0;
  const cachedAt = report.cachedAt ?? 0;
  if (folder) {
    return (
      <>
        <div className="aggregate-summary aggregate-folder-summary">
          <span><strong>{report.items.length}</strong> 条目录内容</span>
          <span>来源：{folder.sourceName || folder.key}</span>
        </div>
        {report.items.length > 0
          ? <ResultGrid items={report.items} visibleLimit={visibleLimit} defaultProfileId={defaultProfileId} picOf={picOf} onImageError={onImageError} onOpenItem={onOpenItem} onShowMore={onShowMore} />
          : <div className="empty">「{folder.name}」里没有可展示的条目。</div>}
        <SourceFailures report={report} scope={scope} />
      </>
    );
  }

  return (
    <>
      <section className="aggregate-summary" aria-label="搜索结果概况">
        {loading && wideSearch && progress && progress.total > 0 && (
          <div className="aggregate-progress" aria-live="polite">
            <div className="aggregate-progress-line">
              <span>正在逐源搜索</span>
              <strong>{progress.done} / {progress.total} 个来源</strong>
            </div>
            <progress aria-label="全源搜索进度" max={progress.total} value={Math.min(progress.done, progress.total)} />
            {progress.pending > 0 && <span className="aggregate-progress-pending">另有 {progress.pending} 个来源正在排队或准备运行。</span>}
          </div>
        )}
        <dl className="aggregate-summary-facts">
          <div className="aggregate-summary-metric"><dt>已检查来源</dt><dd>{report.perSource.length}</dd></div>
          <div className="aggregate-summary-metric"><dt>命中来源</dt><dd>{report.hitSources}</dd></div>
          <div className="aggregate-summary-metric"><dt>找到结果</dt><dd>{report.items.length}</dd></div>
          {view.hiddenCount > 0 && <div className="aggregate-summary-metric"><dt>已过滤不相关片名</dt><dd>{view.hiddenCount}</dd></div>}
        </dl>
        <div className="aggregate-summary-notes">
          {pendingSources > 0 && <span>{pendingSources} 个来源仍在准备，完成后会自动补入。</span>}
          {cachedAt > 0 && <span>显示本地缓存 · 更新于 {formatSearchCacheTime(cachedAt)}</span>}
          {!wideSearch && report.items.length === 0 && <span>当前来源没有匹配结果。</span>}
          {(pendingSources > 0 || cachedAt > 0) && <button className="linkbtn" onClick={onRetry} disabled={loading}>重新搜索</button>}
          {report.failedSources > 0 && <span className="aggregate-summary-warning">{report.failedSources} 个来源查询失败，详情在下方。</span>}
        </div>
      </section>

      <SearchResultFilters
        profiles={view.profiles}
        sources={view.sources}
        profileId={profileFilter}
        sourceId={sourceFilter}
        mode={matchMode}
        hiddenCount={view.hiddenCount}
        onProfile={onProfileFilter}
        onSource={onSourceFilter}
        onMode={onMatchMode}
      />

      {view.items.length > 0 ? (
        <ResultGrid items={view.items} visibleLimit={visibleLimit} defaultProfileId={defaultProfileId} picOf={picOf} onImageError={onImageError} onOpenItem={onOpenItem} onShowMore={onShowMore} />
      ) : (
        <div className="empty">
          {sourceFilter
            ? `该源没有「${query}」的匹配结果。`
            : wideSearch
              ? `${scope === 'all-profiles' ? '全部订阅档案' : '全部源'}均无「${query}」的匹配结果。`
              : `当前源无「${query}」的匹配结果。`}
          {report.failedSources > 0 && (
            <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
              其中 {report.failedSources} 个源查询出错，可能掩盖了结果，请参照下方异常列表重试或更换关键词。
            </div>
          )}
        </div>
      )}

      <SourceFailures report={report} scope={scope} />
    </>
  );
}

function ResultGrid({
  items,
  visibleLimit,
  defaultProfileId,
  picOf,
  onImageError,
  onOpenItem,
  onShowMore,
}: {
  items: AggVodItem[];
  visibleLimit: number;
  defaultProfileId: string;
  picOf: (item: AggVodItem) => string;
  onImageError: HomeSearchResultsModel['onImageError'];
  onOpenItem: HomeSearchResultsModel['onOpenItem'];
  onShowMore?: HomeSearchResultsModel['onShowMore'];
}) {
  return (
    <>
      <div className="grid search-result-grid">
        {items.slice(0, visibleLimit).map((item) => (
          <AggregateMediaCard key={`${sourceIdentityKey(item.sourceRef?.profileId ?? defaultProfileId, item.sourceKey)}-${item.id}`} item={item} pic={picOf(item)} onImageError={onImageError} onOpen={onOpenItem} />
        ))}
      </div>
      {onShowMore && items.length > visibleLimit && (
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <button onClick={onShowMore}>显示更多（还有 {items.length - visibleLimit} 条）</button>
        </div>
      )}
    </>
  );
}

function SourceFailures({ report, scope }: { report: SearchAllReport; scope: HomeSearchScope }) {
  const failed = report.perSource.filter((source) => source.status === 'error');
  if (failed.length === 0) return null;
  return (
    <details className="aggregate-failures">
      <summary>{failed.length} 个来源查询失败 · 展开诊断信息</summary>
      <div className="aggregate-failures-list">
        {failed.map((source) => (
          <div key={`${source.profileId || ''}\u0000${source.key}`}>
            <strong>{source.profileName && scope === 'all-profiles' ? `${source.profileName} · ` : ''}{source.name}</strong>
            <span className="muted">（{source.key}）</span>：{source.error || '未知错误'}
          </div>
        ))}
      </div>
      <p>源站失效、超时或需要扩展配置都可能导致查询失败；可在「设置 → 来源诊断」查看详情。</p>
    </details>
  );
}

const AggregateMediaCard = memo(function AggregateMediaCard({ item, pic, onOpen, onImageError }: {
  item: AggVodItem;
  pic: string;
  onOpen: HomeSearchResultsModel['onOpenItem'];
  onImageError: HomeSearchResultsModel['onImageError'];
}) {
  const sourceLabel = [item.sourceProfileName, item.sourceName || item.sourceKey].filter(Boolean).join(' / ');
  return (
    <HomeMediaCardView
      title={item.name}
      pic={pic}
      remarks={item.remarks}
      folder={item.tag === 'folder'}
      sourceLabel={sourceLabel}
      onOpen={() => onOpen(item)}
      onImageError={(event) => onImageError(item, event.currentTarget.getAttribute('src') || '')}
    />
  );
});

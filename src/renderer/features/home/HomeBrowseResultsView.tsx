import CascadeBar from '../../components/CascadeBarView';
import { Button } from '../../components/ui/Button';
import type { HomeBrowseResultsModel } from './homePageViewModel';
import { HomeVodCardView } from './HomeVodCardView';

/** Passive view for source-native categories, filters, result cards and pagination. */
export function HomeBrowseResultsView({
  classes,
  classLevels,
  filtersOpen,
  fallback,
  items,
  loading,
  error,
  hasSources,
  listStyle,
  cardStyle,
  presetCategories,
  waterfall,
  tid,
  pg,
  pageInfo,
  noMore,
  waterfallStatus,
  waterfallSentinelRef,
  jumpPage,
  picOf,
  onImageError,
  onOpen,
  onCascadePick,
  onToggleFilters,
  onPresetCategory,
  onImportSources,
  onPreviousPage,
  onNextPage,
  onJumpPage,
  onJumpPageChange,
}: HomeBrowseResultsModel) {
  return (
    <>
      {!error && fallback && (
        <div className="banner" style={{ borderLeftColor: 'var(--accent-2)', marginBottom: 12 }}>
          当前展示首个分类的内容，可在下方切换分类。
        </div>
      )}

      {classes.length > 0 && !error && (
        <div className="row home-filter-row">
          <CascadeBar levels={classLevels.slice(0, 1)} onPick={onCascadePick} cardStyle={cardStyle} />
          <button
            type="button"
            className={`home-filter-btn${filtersOpen ? ' active' : ''}`}
            aria-pressed={filtersOpen}
            title={filtersOpen ? '收起源的筛选条件' : '展开源的筛选条件'}
            onClick={onToggleFilters}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 4h18l-7.2 8.4V19l-3.6-2.2v-4.4z" />
            </svg>
            筛选
          </button>
        </div>
      )}

      {classes.length > 0 && !error && filtersOpen && classLevels.length > 1 && (
        <div className="home-filters-more">
          <CascadeBar levels={classLevels.slice(1)} onPick={onCascadePick} cardStyle={cardStyle} />
        </div>
      )}

      {presetCategories.length > 0 && !error && filtersOpen && (
        <div className="row" style={{ marginBottom: 14 }}>
          <span className="muted" style={{ fontSize: 12, marginRight: 6 }}>预设分类：</span>
          {presetCategories.map((category) => {
            const match = classes.find((item) => item.name === category || String(item.id) === category);
            return (
              <button
                type="button"
                key={category}
                className={`tag ui-action ${match && String(match.id) === tid ? 'active' : ''}`}
                aria-pressed={Boolean(match && String(match.id) === tid)}
                onClick={() => onPresetCategory(category)}
              >
                {category}
              </button>
            );
          })}
        </div>
      )}

      {items.length === 0 ? (
        <div className="empty">
          {loading
            ? '加载中…'
            : !hasSources
              ? <><h2>添加你的第一个订阅</h2><p>支持单仓、多仓和本地配置文件。</p><Button variant="primary" onClick={onImportSources}>导入订阅</Button></>
              : error
                ? '加载失败，请查看上方错误提示'
                : <><h2>当前站点暂无内容</h2><p>可以切换分类、在左侧更换站点，或使用顶部搜索。</p></>}
        </div>
      ) : (
        <>
          {listStyle ? (
            <div className="list">
              {items.map((item) => (
                <button type="button" key={item.id} className="list-item ui-action" aria-label={`打开 ${item.name}`} onClick={() => onOpen(item)}>
                  {picOf(item)
                    ? <img src={picOf(item)} alt={item.name} onError={(event) => onImageError(item, event.currentTarget.getAttribute('src') || '')} loading="lazy" decoding="async" />
                    : <div className="no-cover" style={{ width: 42, height: 58, flex: '0 0 auto', textAlign: 'center' }}>暂无封面</div>}
                  <span className="li-name" title={item.name}>{item.name}</span>
                  {item.remarks && <span className="badge">{item.remarks}</span>}
                </button>
              ))}
            </div>
          ) : (
            <div className="grid">
              {items.map((item) => (
                <HomeVodCardView key={item.id} item={item} pic={picOf(item)} onOpen={onOpen} onImageError={onImageError} />
              ))}
            </div>
          )}

          {waterfall && tid !== '' && pageInfo.pagecount > 1 && <div ref={waterfallSentinelRef} style={{ height: 1 }} aria-hidden="true" />}
          {pageInfo.pagecount > 1 && (waterfall && tid !== '' ? (
            <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
              <span className="status">{waterfallStatus}</span>
            </div>
          ) : (
            <div className="row" style={{ justifyContent: 'center', marginTop: 16, flexWrap: 'wrap', rowGap: 8 }}>
              <button disabled={pg <= 1 || loading} onClick={onPreviousPage}>上一页</button>
              <span className="status">{noMore ? `${pg} 页 · 已到底（该源无更多内容）` : pageInfo.pagecount > 999 ? `${pg} 页` : `${pg} / ${pageInfo.pagecount}`}</span>
              <button disabled={pg >= pageInfo.pagecount || loading || noMore} onClick={onNextPage}>下一页</button>
              {tid !== '' && (
                <>
                  <input
                    className="pg-jump"
                    type="text"
                    inputMode="numeric"
                    value={jumpPage}
                    placeholder="页码"
                    aria-label="跳至指定页码"
                    onChange={(event) => onJumpPageChange(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) onJumpPage(); }}
                  />
                  <button disabled={loading || jumpPage.trim() === ''} onClick={onJumpPage} title="跳到输入的页码">跳页</button>
                </>
              )}
            </div>
          ))}
        </>
      )}
    </>
  );
}

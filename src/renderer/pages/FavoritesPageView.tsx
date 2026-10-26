import PosterSizeControl from '../components/PosterSizeControl';
import PluginSlot from '../components/PluginSlot';
import { SelectionButton } from '../components/ui/SelectionButton';
import { favoriteTitle, type FavoriteRow, type FavoriteSortMode } from '../features/favorites/application/favoriteModel';
import type { HistoryCategory } from '../lib/historyCategories';
import type { PosterSize } from '../../shared/posterSize';

interface FavoritesPageViewProps {
  posterSize: PosterSize;
  onPosterSizeChange(size: PosterSize): void;
  titleInputId: string;
  rows: FavoriteRow[];
  filtered: FavoriteRow[];
  groups: HistoryCategory<FavoriteRow>[];
  visibleGroups: HistoryCategory<FavoriteRow>[];
  activeCategory: string;
  keyword: string;
  query: string;
  sort: FavoriteSortMode;
  editing: { key: string; title: string; note: string } | null;
  lastDeleted: FavoriteRow | null;
  notice: string;
  coverFor(item: FavoriteRow): string;
  onCoverError(item: FavoriteRow, url: string): void;
  onQueryChange(query: string): void;
  onSortChange(sort: FavoriteSortMode): void;
  onSelectCategory(category: string): void;
  onOpenDetail(item: FavoriteRow): void;
  onRemove(item: FavoriteRow): void;
  onClearAll(): void;
  onUndoRemove(): void;
  onDismissDeleted(): void;
  onDismissNotice(): void;
  onStartEdit(item: FavoriteRow): void;
  onSaveEdit(): void;
  onSetEditTitle(value: string): void;
  onSetEditNote(value: string): void;
  onCancelEdit(): void;
  onBrowse(): void;
}

export function FavoritesPageView(props: FavoritesPageViewProps) {
  const titleOf = favoriteTitle;

  return (
    <>
      <div className="topbar gallery-page-topbar">
        <span style={{ fontWeight: 700 }}>我的收藏</span>
        <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
          {props.rows.length ? `${props.rows.length} 条${props.keyword ? ` · 匹配 ${props.filtered.length} 条` : ''}` : '尚未收藏任何影片'}
        </span>
        <PosterSizeControl size={props.posterSize} onChange={props.onPosterSizeChange} />
        {props.rows.length > 0 && (
          <button className="linkbtn danger" style={{ marginLeft: 'auto' }} onClick={props.onClearAll}>清空全部收藏</button>
        )}
      </div>
      <PluginSlot slot="favorites" />
      {props.lastDeleted && (
        <output className="hist-undo">
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            已移除「{titleOf(props.lastDeleted)}」
          </span>
          <button className="linkbtn" onClick={props.onUndoRemove}>撤销</button>
          <button className="linkbtn muted-btn" onClick={props.onDismissDeleted}>关闭</button>
        </output>
      )}
      {props.notice && (
        <output className="hist-undo">
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{props.notice}</span>
          <button className="linkbtn muted-btn" onClick={props.onDismissNotice}>关闭</button>
        </output>
      )}

      <div className="content hist-content">
        {props.rows.length === 0 ? (
          <div className="empty"><h2>还没有收藏</h2><p>在影片详情页点击「收藏」，即可保存到这里。</p><button className="primary" onClick={props.onBrowse}>浏览点播</button></div>
        ) : (
          <>
            <div className="quick-picks" style={{ alignItems: 'center' }}>
              <input
                value={props.query}
                onChange={(event) => props.onQueryChange(event.target.value)}
                placeholder="搜索片名 / 备注 / 来源…"
                style={{ flex: '0 1 260px', minWidth: 140, fontSize: 12 }}
                aria-label="搜索收藏"
              />
              <SelectionButton selected={props.sort === 'recent'} onClick={() => props.onSortChange('recent')}>最近收藏</SelectionButton>
              <SelectionButton selected={props.sort === 'name'} onClick={() => props.onSortChange('name')}>按名称</SelectionButton>
            </div>
            <fieldset className="quick-picks hist-filters" aria-label="收藏来源分类" style={{ border: 0, padding: 0, minWidth: 0 }}>
              <span className="muted">按来源筛选：</span>
              <SelectionButton selected={props.activeCategory === ''} onClick={() => props.onSelectCategory('')}>
                全部 {props.filtered.length}
              </SelectionButton>
              {props.groups.map((group) => (
                <SelectionButton key={group.key} selected={props.activeCategory === group.key} onClick={() => props.onSelectCategory(group.key)}>
                  {group.label} {group.items.length}
                </SelectionButton>
              ))}
            </fieldset>
            {props.filtered.length === 0 ? (
              <div className="empty" style={{ marginTop: 30 }}>没有匹配「{props.query.trim()}」的收藏</div>
            ) : (
              props.visibleGroups.map((group) => (
                <section className="hist-group" key={group.key}>
                  <h3>{group.label}<span className="muted"> · {group.items.length} 条</span></h3>
                  <div className="grid">
                    {group.items.map((item) => {
                      const editingThis = props.editing?.key === item.key;
                      const cover = props.coverFor(item);
                      return (
                        <div className="card-media hist-media" key={item.key}>
                          <div className="card">
                            <div className="media-poster">
                              <button type="button" className="favorite-cover-button" onClick={() => props.onOpenDetail(item)} aria-label={`打开 ${titleOf(item)} 详情`}>
                                {cover ? (
                                  <img src={cover} alt={titleOf(item)} onError={(event) => props.onCoverError(item, event.currentTarget.getAttribute('src') || '')} loading="lazy" decoding="async" />
                                ) : (
                                  <div className="no-cover">暂无封面</div>
                                )}
                              </button>
                            </div>
                            <div className="meta">
                              <button type="button" className="name favorite-title-link" onClick={() => props.onOpenDetail(item)} title={titleOf(item)}>{titleOf(item)}</button>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                                {item.remarks && <span className="muted" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.remarks}</span>}
                                {item.createdAt > 0 && <span className="muted" style={{ fontSize: 12, marginLeft: 'auto', flex: 'none' }}>{formatDate(item.createdAt)}</span>}
                              </div>
                              {item.note && !editingThis && (
                                <button type="button" className="fav-note" title="编辑备注" onClick={() => props.onStartEdit(item)}>{item.note}</button>
                              )}
                            </div>
                            {editingThis && props.editing && (
                              <div className="fav-edit">
                                <input
                                  id={props.titleInputId}
                                  value={props.editing.title}
                                  placeholder="显示名（留空用源片名）"
                                  onChange={(event) => props.onSetEditTitle(event.target.value)}
                                  onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) props.onSaveEdit(); }}
                                />
                                <input
                                  value={props.editing.note}
                                  placeholder="备注 / 短评…"
                                  onChange={(event) => props.onSetEditNote(event.target.value)}
                                  onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) props.onSaveEdit(); }}
                                />
                                <div className="row" style={{ gap: 6 }}>
                                  <button className="primary" onClick={props.onSaveEdit}>保存</button>
                                  <button onClick={props.onCancelEdit}>取消</button>
                                </div>
                              </div>
                            )}
                            {!editingThis && (
                              <div className="hist-ops">
                                <button type="button" aria-label={`编辑收藏信息 ${titleOf(item)}`} title="编辑显示名与备注" onClick={(event) => { event.stopPropagation(); props.onStartEdit(item); }}>
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 013 3L8 18l-4 1 1-4Z" />
                                  </svg>
                                  编辑
                                </button>
                                <button type="button" aria-label={`从收藏移除 ${titleOf(item)}`} title="移除收藏" onClick={(event) => { event.stopPropagation(); props.onRemove(item); }}>
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3" />
                                  </svg>
                                  移除
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))
            )}
          </>
        )}
      </div>
    </>
  );
}

function formatDate(timestamp: number): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getMonth() + 1}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

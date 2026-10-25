import PosterSizeControl from '../components/PosterSizeControl';
import PluginSlot from '../components/PluginSlot';
import { Tabs } from '../components/ui/Tabs';
import { Button } from '../components/ui/Button';
import { historyItemKey, historyUpdateKey } from '../features/history/application/historyPage';
import type { HistoryCategory } from '../lib/historyCategories';
import type { WatchHistory } from '../lib/uiMemoryTypes';

interface HistoryPageViewProps {
  items: WatchHistory[];
  groups: HistoryCategory<WatchHistory>[];
  visibleGroups: HistoryCategory<WatchHistory>[];
  activeCategory: string;
  lastDeleted: WatchHistory | null;
  notice: string;
  updated: Record<string, boolean>;
  resumeCount: number;
  coverFor(item: WatchHistory): string;
  onCoverError(item: WatchHistory, url: string): void;
  onSelectCategory(category: string): void;
  onPlay(item: WatchHistory): void;
  onOpenDetail(item: WatchHistory): void;
  onRemove(item: WatchHistory): void;
  onClearAll(): void;
  onUndoRemove(): void;
  onDismissDeleted(): void;
  onDismissNotice(): void;
  onBrowse(): void;
}

export function HistoryPageView(props: HistoryPageViewProps) {
  const { items, groups, visibleGroups, activeCategory, lastDeleted, notice, updated, resumeCount } = props;

  return (
    <>
      <div className="topbar gallery-page-topbar">
        <span style={{ fontWeight: 700 }}>观看历史</span>
        <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
          {items.length ? `${items.length} 条${resumeCount ? ` · ${resumeCount} 条可续播` : ''} · 自动保存` : '尚未有播放记录'}
        </span>
        <PosterSizeControl />
        {items.length > 0 && (
          <button className="linkbtn danger" style={{ marginLeft: 'auto' }} onClick={props.onClearAll}>
            清空全部
          </button>
        )}
      </div>
      <PluginSlot slot="history" />
      {lastDeleted && (
        <output className="hist-undo">
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            已移除「{lastDeleted.name}」
          </span>
          <button className="linkbtn" onClick={props.onUndoRemove}>撤销</button>
          <button className="linkbtn muted-btn" onClick={props.onDismissDeleted}>关闭</button>
        </output>
      )}
      {notice && (
        <output className="hist-undo">
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{notice}</span>
          <button className="linkbtn muted-btn" onClick={props.onDismissNotice}>关闭</button>
        </output>
      )}
      <div className="content hist-content">
        {items.length === 0 ? (
          <div className="empty">
            <h2>还没有观看记录</h2>
            <p>播放影片后，可以在这里继续观看。</p>
            <Button variant="primary" onClick={props.onBrowse}>浏览点播</Button>
          </div>
        ) : (
          <>
            <section className="history-filter-section" aria-label="历史来源分类">
              <span className="muted">按来源筛选</span>
              <Tabs
                items={[{ id: '__all__', label: `全部 ${items.length}` }, ...groups.map((group) => ({ id: group.key, label: `${group.label} ${group.items.length}` }))]}
                value={activeCategory || '__all__'}
                onChange={(id) => props.onSelectCategory(id === '__all__' ? '' : id)}
                label="观看历史来源"
                idPrefix="history"
                panelId="history-panel"
                className="hist-filters"
              />
            </section>
            <div id="history-panel" className="history-results-panel" role="tabpanel" aria-labelledby={`history-tab-${activeCategory || '__all__'}`} tabIndex={0}>
              {visibleGroups.map((group) => (
                <section className="hist-group" key={group.key}>
                  <h3>{group.label}<span className="muted"> · {group.items.length} 条</span></h3>
                  <div className="grid">
                    {group.items.map((item) => {
                      const cover = props.coverFor(item);
                      return (
                        <div className="card-media hist-media history-card-media" key={historyItemKey(item)}>
                          <button type="button" className="card hist-card-action ui-action" aria-label={`播放 ${item.name}`} onClick={() => props.onPlay(item)}>
                            <div className="media-poster">
                              {cover ? (
                                <img src={cover} alt={item.name} onError={(event) => props.onCoverError(item, event.currentTarget.getAttribute('src') || '')} loading="lazy" decoding="async" />
                              ) : (
                                <div className="no-cover">暂无封面</div>
                              )}
                              <div className="hist-corner">
                                {item.time > 0 && <span className="badge">▶ {formatTime(item.time)}</span>}
                              </div>
                              {updated[historyUpdateKey(item)] && (
                                <span className="history-update-badge" title="该资源在源内已有新集">有更新</span>
                              )}
                            </div>
                            <div className="meta">
                              <div className="name" title={item.name}>{item.name}</div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                                {item.remarks && <span className="muted" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.remarks}</span>}
                                {item.updatedAt > 0 && <span className="muted" style={{ fontSize: 12, marginLeft: 'auto', flex: 'none' }}>{formatDate(item.updatedAt)}</span>}
                              </div>
                            </div>
                          </button>
                          <div className="hist-actions">
                            {item.sourceKey && item.vodId && (
                              <button type="button" className="hist-detail-action" title="打开影片详情" onClick={() => props.onOpenDetail(item)}>
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" />
                                </svg>
                                详情
                              </button>
                            )}
                            <button type="button" className="hist-remove-action" title="从观看历史移除" aria-label={`从观看历史移除 ${item.name}`} onClick={() => props.onRemove(item)}>
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3" />
                              </svg>
                              移除
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = Math.floor(seconds % 60);
  return `${hours > 0 ? `${hours}:` : ''}${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function formatDate(timestamp: number): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getMonth() + 1}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

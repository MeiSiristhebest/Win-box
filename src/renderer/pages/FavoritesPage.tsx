// src/renderer/pages/FavoritesPage.tsx — 我的收藏（增删改查）：
//   · 增：详情页「收藏」按钮（本页也能从卡片进详情后再收藏）；
//   · 查：关键词搜索（片名/备注/来源）+ 按「订阅-源」分组筛选 + 排序（最近收藏 / 名称）；
//   · 改：卡片内行内编辑「显示名 + 备注」（留空 = 回落源片名）；
//   · 删：卡片右上角常驻 ✕ / 悬停「移除」，移除后可**撤销**（无损还原）；顶栏可清空全部。
// 卡片与样式复用观看历史那一套（`.card-media`/`.hist-media`/`.hist-corner`/`.hist-ops`/`.hist-undo`）。
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { client } from '../api/client';
// ★ 2026-10-18 受限 UI 槽位（`contributes.ui.slot`）：宿主页面的槽位落点
import PluginSlot from '../components/PluginSlot';
import { useCovers } from '../lib/useCovers';
import { openDetailRoute } from '../lib/detailWin';
import { restoreHistorySource } from '../lib/historySource';
import { historyCategories } from '../lib/historyCategories';
import {
  FAVORITES_EVENT,
  clearFavorites,
  favoriteTitle,
  listFavoritesWithKeys,
  loadFavorites,
  removeFavorite,
  restoreFavorite,
  updateFavorite,
  type FavoriteItem,
} from '../lib/favorites';
import type { ProfileSitesView } from '../../shared/types';

/** 行 = 收藏记录 + 它**自身的存储键**（删除/编辑直接用它，不必按片子反推） */
type Row = FavoriteItem & { key: string };
type SortMode = 'recent' | 'name';

function fmtDate(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function subscribeFavorites(notify: () => void): () => void {
  const refresh = () => { loadFavorites(); notify(); };
  window.addEventListener(FAVORITES_EVENT, refresh);
  window.addEventListener('storage', refresh);
  window.addEventListener('focus', refresh);
  refresh();
  return () => {
    window.removeEventListener(FAVORITES_EVENT, refresh);
    window.removeEventListener('storage', refresh);
    window.removeEventListener('focus', refresh);
  };
}
function favoritesSnapshot(): string { return JSON.stringify(listFavoritesWithKeys()); }

export default function FavoritesPage() {
  const nav = useNavigate();
  const snapshot = useSyncExternalStore(subscribeFavorites, favoritesSnapshot);
  const rows = useMemo<Row[]>(() => (JSON.parse(snapshot) as ReturnType<typeof listFavoritesWithKeys>).map(({ key, item }) => ({ ...item, key })), [snapshot]);
  const editTitleRef = useRef<HTMLInputElement>(null);
  const [profileView, setProfileView] = useState<ProfileSitesView>({ activeId: '', profiles: [] });
  /** 查：关键词 + 排序 + 分组筛选 */
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortMode>('recent');
  const [category, setCategory] = useState('');
  /** 改：当前正在编辑的收藏（键 => 草稿） */
  const [editing, setEditing] = useState<{ key: string; title: string; note: string } | null>(null);
  /** 删：最近一条被移除的收藏（可撤销） */
  const [lastDeleted, setLastDeleted] = useState<Row | null>(null);
  const [notice, setNotice] = useState('');

  const editingKey = editing?.key;
  useEffect(() => { if (editingKey) editTitleRef.current?.focus(); }, [editingKey]);

  useEffect(() => {
    // 源名映射（分组标签用）：订阅/源列表被配置页改动时跟随刷新
    const loadView = (): void => {
      void Promise.all([client.cfgGet(), client.cfgProfileSites()])
        .then(([c, view]) => {
          if (!view.profiles.some((p) => p.id === c.activeProfileId)) {
            view.profiles.push({ id: c.activeProfileId, name: '当前配置', sites: c.sources });
          }
          setProfileView({ ...view, activeId: c.activeProfileId });
        })
        .catch(() => undefined);
    };
    loadView();
    window.addEventListener('winbox:sources-changed', loadView);
    return () => {
      window.removeEventListener('winbox:sources-changed', loadView);
    };
  }, []);

  const kw = q.trim().toLowerCase();
  const filtered = rows.filter((it) => {
    if (!kw) return true;
    return [favoriteTitle(it), it.name, it.note, it.remarks, it.sourceName]
      .some((s) => (s || '').toLowerCase().includes(kw));
  });
  const sorted = sort === 'name'
    ? [...filtered].sort((a, b) => favoriteTitle(a).localeCompare(favoriteTitle(b), 'zh'))
    : filtered;
  const groups = historyCategories(sorted, profileView);
  const activeCategory = groups.some((g) => g.key === category) ? category : '';
  const visibleGroups = activeCategory ? groups.filter((g) => g.key === activeCategory) : groups;

  const coverItem = (it: FavoriteItem) => ({ id: `${it.sourceKey || ''}\u0000${it.vodId || ''}`, name: favoriteTitle(it), pic: it.pic });
  const covers = useCovers(sorted.map(coverItem));
  const picOf = (it: FavoriteItem) => covers.picOf(coverItem(it));
  const picErr = (it: FavoriteItem) => (e: React.SyntheticEvent<HTMLImageElement>) =>
    covers.onError(coverItem(it), e.currentTarget.getAttribute('src') || '');

  /** 点卡片 / 「详情」→ 先恢复正确的订阅与源，再进详情页（与历史页同一条链路） */
  const openDetail = (it: FavoriteItem): void => {
    if (!it.sourceKey || !it.vodId) return;
    void restoreHistorySource(client, it)
      .then((source) => {
        window.dispatchEvent(new CustomEvent('winbox:sources-changed'));
        return openDetailRoute((to) => nav(to), source.key, it.vodId as string);
      })
      .catch((e) => setNotice(`打开详情失败：${e instanceof Error ? e.message : String(e)}`));
  };

  const del = (it: Row): void => {
    if (removeFavorite(it.key)) setLastDeleted(it);
  };

  const undo = (): void => {
    if (!lastDeleted) return;
    if (restoreFavorite(lastDeleted)) {
      setLastDeleted(null);
      }
  };

  const clearAll = (): void => {
    clearFavorites();
    setLastDeleted(null);
    setEditing(null);
  };

  const startEdit = (it: Row): void => {
    setEditing({ key: it.key, title: (it.title || '').trim(), note: (it.note || '').trim() });
  };

  const saveEdit = (): void => {
    if (!editing) return;
    updateFavorite(editing.key, { title: editing.title.trim(), note: editing.note.trim() });
    setEditing(null);
  };

  return (
    <>
      <div className="topbar">
        <span style={{ fontWeight: 700 }}>我的收藏</span>
        <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
          {rows.length ? `${rows.length} 条${kw ? ` · 匹配 ${filtered.length} 条` : ''}` : '尚未收藏任何影片'}
        </span>
        {rows.length > 0 && (
          <button className="linkbtn danger" style={{ marginLeft: 'auto' }} onClick={clearAll}>
            清空全部收藏
          </button>
        )}
      </div>

      {/* ★ 2026-10-18 插件受限 UI 槽位（`contributes.ui.slot`；无插件声明时零影响） */}
      <PluginSlot slot="favorites" />

      {/* 撤销条：单条移除后出现，可无损还原（含原收藏时间与备注） */}
      {lastDeleted && (
        <output className="hist-undo">
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            已移除「{favoriteTitle(lastDeleted)}」
          </span>
          <button className="linkbtn" onClick={undo}>撤销</button>
          <button className="linkbtn muted-btn" onClick={() => setLastDeleted(null)}>关闭</button>
        </output>
      )}
      {notice && (
        <output className="hist-undo">
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{notice}</span>
          <button className="linkbtn muted-btn" onClick={() => setNotice('')}>关闭</button>
        </output>
      )}

      <div className="content hist-content">
        {rows.length === 0 ? (
          <div className="empty" style={{ marginTop: 40 }}>暂无收藏 —— 在影片详情页点「收藏」即可加入这里</div>
        ) : (
          <>
            <div className="quick-picks" style={{ alignItems: 'center' }}>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜索片名 / 备注 / 来源…"
                style={{ flex: '0 1 260px', minWidth: 140, fontSize: 12 }}
                aria-label="搜索收藏"
              />
              <button className={`tag ${sort === 'recent' ? 'active' : ''}`} aria-pressed={sort === 'recent'} onClick={() => setSort('recent')}>
                最近收藏
              </button>
              <button className={`tag ${sort === 'name' ? 'active' : ''}`} aria-pressed={sort === 'name'} onClick={() => setSort('name')}>
                按名称
              </button>
            </div>
            <fieldset className="quick-picks hist-filters" aria-label="收藏来源分类" style={{ border: 0, padding: 0, minWidth: 0 }}>
              <span className="muted">按来源筛选：</span>
              <button className={`tag ${activeCategory === '' ? 'active' : ''}`} aria-pressed={activeCategory === ''} onClick={() => setCategory('')}>
                全部 {filtered.length}
              </button>
              {groups.map((group) => (
                <button
                  key={group.key}
                  className={`tag ${activeCategory === group.key ? 'active' : ''}`}
                  aria-pressed={activeCategory === group.key}
                  onClick={() => setCategory(group.key)}
                >
                  {group.label} {group.items.length}
                </button>
              ))}
            </fieldset>
            {filtered.length === 0 ? (
              <div className="empty" style={{ marginTop: 30 }}>没有匹配「{q.trim()}」的收藏</div>
            ) : (
              visibleGroups.map((group) => (
                <section className="hist-group" key={group.key}>
                  <h3>{group.label}<span className="muted"> · {group.items.length} 条</span></h3>
                  <div className="grid">
                    {group.items.map((it) => {
                      const cover = picOf(it);
                      const editingThis = editing?.key === it.key;
                      return (
                        <div className="card-media hist-media" key={it.key}>
                          <div className="card">
                            <div style={{ position: 'relative' }}>
                              <button type="button" onClick={() => openDetail(it)} aria-label={`打开 ${favoriteTitle(it)} 详情`} style={{ display: 'block', width: '100%', padding: 0, border: 0, background: 'transparent' }}>
                              {cover ? (
                                <img src={cover} alt={favoriteTitle(it)} onError={picErr(it)} loading="lazy" decoding="async" />
                              ) : (
                                <div
                                  style={{
                                    aspectRatio: '2/3', width: '100%', background: 'linear-gradient(160deg, var(--surface-3), var(--surface-2))',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: 11,
                                  }}
                                >
                                  暂无封面
                                </div>
                              )}
                              </button>
                              <div className="hist-corner">
                                <button
                                  className="hist-del"
                                  title="移除这条收藏"
                                  aria-label={`移除 ${favoriteTitle(it)}`}
                                  onClick={(e) => { e.stopPropagation(); del(it); }}
                                >
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                                    <path d="M6 6l12 12M18 6L6 18" />
                                  </svg>
                                </button>
                              </div>
                              {/* 左上角来源 chip：显示资源来自哪个源 */}
                              {(it.sourceName || it.sourceKey) && (
                                <span
                                  style={{
                                    position: 'absolute', left: 6, top: 6, background: 'rgba(0,0,0,.62)', color: 'var(--accent)',
                                    fontSize: 10, padding: '1px 7px', borderRadius: 999, maxWidth: '62%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                  }}
                                  title={group.label}
                                >
                                  {it.sourceName || it.sourceKey}
                                </span>
                              )}
                            </div>
                            <div className="meta">
                              <button type="button" className="name" onClick={() => openDetail(it)} title={favoriteTitle(it)} style={{ display: 'block', width: '100%', padding: 0, border: 0, textAlign: 'left', background: 'transparent' }}>{favoriteTitle(it)}</button>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                                {it.remarks && (
                                  <span className="muted" style={{ fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.remarks}</span>
                                )}
                                {it.createdAt > 0 && (
                                  <span className="muted" style={{ fontSize: 10, marginLeft: 'auto', flex: 'none' }}>{fmtDate(it.createdAt)}</span>
                                )}
                              </div>
                              {it.note && !editingThis && (
                                <button type="button" className="fav-note" title="编辑备注" onClick={() => startEdit(it)}>
                                  {it.note}
                                </button>
                              )}
                            </div>
                            {/* 改：行内编辑显示名 + 备注（留空 = 回落源片名） */}
                            {editingThis && editing && (
                              <div className="fav-edit">
                                <input
                                  ref={editTitleRef}
                                  value={editing.title}
                                  placeholder="显示名（留空用源片名）"
                                  onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                                  onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); }}
                                />
                                <input
                                  value={editing.note}
                                  placeholder="备注 / 短评…"
                                  onChange={(e) => setEditing({ ...editing, note: e.target.value })}
                                  onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); }}
                                />
                                <div className="row" style={{ gap: 6 }}>
                                  <button className="primary" onClick={saveEdit}>保存</button>
                                  <button onClick={() => setEditing(null)}>取消</button>
                                </div>
                              </div>
                            )}
                            <div className="hist-ops">
                              <button title="打开详情" onClick={(e) => { e.stopPropagation(); openDetail(it); }}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
                                详情
                              </button>
                              <button title="编辑显示名与备注" onClick={(e) => { e.stopPropagation(); startEdit(it); }}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 20h4L19 9l-4-4L4 16v4z" /><path d="M14 6l4 4" /></svg>
                                编辑
                              </button>
                              <button title="移除收藏" onClick={(e) => { e.stopPropagation(); del(it); }}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>
                                移除
                              </button>
                            </div>
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

import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BOARD_CATEGORIES, DOMESTIC_BOARDS, pluginSectionToBoard, TMDB_BOARDS, type DiscoverBoard } from '../../shared/discoverBoards';
import { Icon } from '../components/ui/Icon';
import BoardPreviewCard, { type BoardPreview } from '../features/discovery/components/BoardPreviewCard';
import { usePageActive } from '../lib/keepAlive';
import { Tabs } from '../components/ui/Tabs';
import { discoverBoardDirectoryAdapter, discoverBoardPreviewAdapter } from '../features/discovery/adapters/discoveryAdapters';
import '../features/discovery/boards.css';

export default function BoardsPage() {
  const active = usePageActive();
  const [params, setParams] = useSearchParams();
  const category = BOARD_CATEGORIES.find(option => option.id === params.get('category'))?.id || '';
  const selectedCategory = category || 'all';
  const categoryTabs = [{ id: 'all', label: '全部' }, ...BOARD_CATEGORIES.map(option => ({ id: option.id, label: option.label }))];
  const [query, setQuery] = useState('');
  const selectCategory = (value: string) => { const next = new URLSearchParams(params); if (value) next.set('category', value); else next.delete('category'); setParams(next, { replace: true }); };
  const [plugins, setPlugins] = useState<DiscoverBoard[]>([]);
  const [previews, setPreviews] = useState<Record<string, BoardPreview>>({});
  const [hasTmdbKey, setHasTmdbKey] = useState<boolean | null>(null);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const builtin = new Set([...DOMESTIC_BOARDS, ...TMDB_BOARDS].map(board => board.id));
    void discoverBoardDirectoryAdapter.loadSections().then(sections => {
      if (cancelled) return;
      setPreviews(Object.fromEntries(sections.filter(section => section.items.length > 0).map(section => [section.browseId || section.id, { items: section.items.slice(0, 3), stale: section.stale }])));
      setPlugins(sections.filter(section => section.browseId?.startsWith('plugin:') || !builtin.has(section.id)).map(pluginSectionToBoard));
    }).catch(() => undefined);
    void discoverBoardDirectoryAdapter.hasTmdbCredentials().then(value => { if (!cancelled) setHasTmdbKey(value); }).catch(() => { if (!cancelled) setHasTmdbKey(false); });
    return () => { cancelled = true; };
  }, [active]);
  const keyword = query.trim().toLocaleLowerCase();
  const matches = (board: DiscoverBoard) => (!category || board.category === category) && (!keyword || (board.title + ' ' + board.description + ' ' + board.provider).toLocaleLowerCase().includes(keyword));
  const boards = [...DOMESTIC_BOARDS, ...(hasTmdbKey ? TMDB_BOARDS : []), ...plugins].filter(matches)
    .sort((a, b) => BOARD_CATEGORIES.findIndex(option => option.id === a.category) - BOARD_CATEGORIES.findIndex(option => option.id === b.category));
  const lockedBoards = hasTmdbKey ? [] : TMDB_BOARDS.filter(matches);
  const count = boards.length + lockedBoards.length;
  return <div className="content board-directory">
    <header className="page-heading"><h1>榜单</h1><span className="page-heading-meta">{count} 个榜单</span></header>
    <div className="board-directory-filters">
      <Tabs
        items={categoryTabs}
        value={selectedCategory}
        onChange={value => selectCategory(value === 'all' ? '' : value)}
        label="筛选榜单类型"
        idPrefix="boards-category"
        panelId="boards-panel"
        className="browse-tabs board-category-filters"
      />
      <label className="board-directory-search"><Icon name="search" size={16} /><input type="search" aria-label="搜索榜单" placeholder="搜索榜单" value={query} onChange={event => setQuery(event.currentTarget.value)} /></label>
    </div>
    <div id="boards-panel" role="tabpanel" aria-labelledby={`boards-category-tab-${selectedCategory}`}>
    {!count && <div className="empty"><h2>没有符合条件的榜单</h2><button type="button" onClick={() => { setQuery(''); selectCategory(''); }}>清除筛选</button></div>}
    <div className="board-directory-grid">{boards.map(board => <BoardPreviewCard key={board.id} board={board} seed={previews[board.id]} active={active} previewPort={discoverBoardPreviewAdapter} />)}</div>
    {lockedBoards.length > 0 && <section className="board-provider-setup" aria-label="TMDB 榜单" aria-busy={hasTmdbKey === null}>
      <header><div><h2>TMDB</h2><span>{lockedBoards.length} 个榜单 · 需要凭据</span></div><Link className="board-setup-link" to="/config?section=meta">设置凭据<Icon name="right" size={14} /></Link></header>
      <details><summary>查看榜单名称</summary><div className="board-provider-list">{lockedBoards.map(board => <Link key={board.id} to="/config?section=meta">{board.title}<Icon name="right" size={13} /></Link>)}</div></details>
    </section>}
    </div>
  </div>;
}

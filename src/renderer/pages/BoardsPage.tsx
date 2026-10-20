import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { client } from '../api/client';
import { BOARD_CATEGORIES, DOMESTIC_BOARDS, TMDB_BOARDS, type DiscoverBoard } from '../../shared/discoverBoards';
import { Icon } from '../components/ui/Icon';
import BoardPreviewCard, { type BoardPreview } from '../components/BoardPreviewCard';
import { usePageActive } from '../lib/keepAlive';
import '../features/discovery/boards.css';

export default function BoardsPage() {
  const active = usePageActive();
  const [params, setParams] = useSearchParams();
  const category = BOARD_CATEGORIES.find(option => option.id === params.get('category'))?.id || '';
  const [query, setQuery] = useState('');
  const selectCategory = (value: string) => { const next = new URLSearchParams(params); if (value) next.set('category', value); else next.delete('category'); setParams(next, { replace: true }); };
  const [plugins, setPlugins] = useState<DiscoverBoard[]>([]);
  const [previews, setPreviews] = useState<Record<string, BoardPreview>>({});
  const [hasTmdbKey, setHasTmdbKey] = useState<boolean | null>(null);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const builtin = new Set([...DOMESTIC_BOARDS, ...TMDB_BOARDS].map(board => board.id));
    void client.metaDiscover().then(sections => {
      if (cancelled) return;
      setPreviews(Object.fromEntries(sections.filter(section => section.items.length > 0).map(section => [section.browseId || section.id, { items: section.items.slice(0, 3), stale: section.stale }])));
      setPlugins(sections.filter(section => section.browseId?.startsWith('plugin:') || !builtin.has(section.id)).map(section => ({ id: section.browseId || section.id, title: section.title, provider: 'plugin', description: '插件提供的内容列表。' })));
    }).catch(() => undefined);
    void client.metaGetSettings().then(settings => { if (!cancelled) setHasTmdbKey(settings.hasUserKey); }).catch(() => { if (!cancelled) setHasTmdbKey(false); });
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
      <fieldset className="browse-tabs board-category-filters" aria-label="筛选榜单类型"><button type="button" className="browse-tab" aria-pressed={!category} onClick={() => selectCategory('')}>全部</button>{BOARD_CATEGORIES.map(option => <button type="button" className="browse-tab" aria-pressed={category === option.id} key={option.id} onClick={() => selectCategory(option.id)}>{option.label}</button>)}</fieldset>
      <label className="board-directory-search"><Icon name="search" size={16} /><input type="search" aria-label="搜索榜单" placeholder="搜索榜单" value={query} onChange={event => setQuery(event.currentTarget.value)} /></label>
    </div>
    {!count && <div className="empty"><h2>没有符合条件的榜单</h2><button type="button" onClick={() => { setQuery(''); selectCategory(''); }}>清除筛选</button></div>}
    <div className="board-directory-grid">{boards.map(board => <BoardPreviewCard key={board.id} board={board} seed={previews[board.id]} active={active} />)}</div>
    {lockedBoards.length > 0 && <section className="board-provider-setup" aria-label="TMDB 榜单" aria-busy={hasTmdbKey === null}>
      <header><div><h2>TMDB</h2><span>{lockedBoards.length} 个榜单 · 需要凭据</span></div><Link className="board-setup-link" to="/config?section=meta">设置凭据<Icon name="right" size={14} /></Link></header>
      <details><summary>查看榜单名称</summary><div className="board-provider-list">{lockedBoards.map(board => <Link key={board.id} to="/config?section=meta">{board.title}<Icon name="right" size={13} /></Link>)}</div></details>
    </section>}
  </div>;
}

import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BOARD_CATEGORIES } from '../../shared/discoverBoards';
import { Icon } from '../components/ui/Icon';
import BoardPreviewCard from '../features/discovery/components/BoardPreviewCard';
import { usePageActive } from '../lib/keepAlive';
import { Tabs } from '../components/ui/Tabs';
import { discoverBoardDirectoryAdapter, discoverBoardPreviewAdapter } from '../features/discovery/adapters/discoveryAdapters';
import { projectBoardDirectory } from '../features/discovery/application/boardDirectoryPresentation';
import { useBoardDirectoryPresenter } from '../features/discovery/useBoardDirectoryPresenter';
import '../features/discovery/boards.css';

export default function BoardsPage() {
  const active = usePageActive();
  const [params, setParams] = useSearchParams();
  const category = BOARD_CATEGORIES.find(option => option.id === params.get('category'))?.id || '';
  const selectedCategory = category || 'all';
  const categoryTabs = [{ id: 'all', label: '全部' }, ...BOARD_CATEGORIES.map(option => ({ id: option.id, label: option.label }))];
  const [query, setQuery] = useState('');
  const selectCategory = (value: string) => { const next = new URLSearchParams(params); if (value) next.set('category', value); else next.delete('category'); setParams(next, { replace: true }); };
  const directory = useBoardDirectoryPresenter(discoverBoardDirectoryAdapter, active);
  const { boards, lockedBoards, previews } = useMemo(
    () => projectBoardDirectory(directory.sections, {
      hasCredentials: directory.hasTmdbCredentials,
      status: directory.credentialsStatus,
    }, { categoryId: category, query }),
    [directory.sections, directory.hasTmdbCredentials, directory.credentialsStatus, category, query],
  );
  const count = boards.length + lockedBoards.length;
  const directoryLoading = directory.sectionsStatus === 'loading' || directory.credentialsStatus === 'loading';
  return <div className="content board-directory">
    <header className="page-heading"><h1>榜单</h1><span className="page-heading-meta">{count} 个榜单</span></header>
    {directory.sectionsError && <div className="board-error" role="alert"><span>{directory.sectionsError}，已保留可显示的榜单。</span><button type="button" onClick={() => void directory.retrySections()} disabled={directory.sectionsStatus === 'loading'}>重试加载榜单</button></div>}
    {directory.credentialsError && <div className="board-error" role="alert"><span>无法确认 TMDB 凭据状态：{directory.credentialsError}。TMDB 榜单状态未知。</span><button type="button" onClick={() => void directory.retryCredentials()} disabled={directory.credentialsStatus === 'loading'}>重试检查</button></div>}
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
    {!count && !directoryLoading && <div className="empty"><h2>没有符合条件的榜单</h2><button type="button" onClick={() => { setQuery(''); selectCategory(''); }}>清除筛选</button></div>}
    <div className="board-directory-grid">{boards.map(board => <BoardPreviewCard key={board.id} board={board} seed={previews[board.id]} active={active} previewPort={discoverBoardPreviewAdapter} />)}</div>
    {directory.sectionsStatus === 'loading' && directory.sections.length === 0 && <output className="board-feed-status" aria-live="polite">正在加载榜单…</output>}
    {directory.credentialsStatus === 'loading' && <output className="board-feed-status" aria-live="polite">正在检查 TMDB 凭据状态…</output>}
    {lockedBoards.length > 0 && <section className="board-provider-setup" aria-label="TMDB 榜单" aria-busy={directory.credentialsStatus === 'loading'}>
      <header><div><h2>TMDB</h2><span>{lockedBoards.length} 个榜单 · 需要凭据</span></div><Link className="board-setup-link" to="/config?section=meta">设置凭据<Icon name="right" size={14} /></Link></header>
      <details><summary>查看榜单名称</summary><div className="board-provider-list">{lockedBoards.map(board => <Link key={board.id} to="/config?section=meta">{board.title}<Icon name="right" size={13} /></Link>)}</div></details>
    </section>}
    </div>
  </div>;
}

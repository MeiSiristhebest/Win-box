import PosterSizeControl from '../components/PosterSizeControl';
import { useEffect, useRef } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BOARD_CATEGORIES, boardSourceName, discoverBoardById } from '../../shared/discoverBoards';
import { useDiscoverBoard } from '../features/discovery/useDiscoverBoard';
import { discoverBoardAdapter } from '../features/discovery/adapters/discoveryAdapters';
import { useBoardPageCapacity } from '../features/discovery/useBoardPageCapacity';
import DiscoverItemCard, { discoverCoverItem } from '../components/DiscoverItemCard';
import { Icon } from '../components/ui/Icon';
import { useCovers } from '../features/covers/useCovers';
import { useTheme } from '../lib/theme';
import { usePageActive } from '../lib/keepAlive';
import { discoverPresentationView } from '../lib/presentationRegistry';
import { discoverDetailRoute } from '../../shared/discoverDetail';
import type { DiscoverItem } from '../../shared/types';
import '../features/discovery/boards.css';

export default function DiscoverBoardPage() {
  const { boardId = '' } = useParams();
  const active = usePageActive();
  const [params, setParams] = useSearchParams();
  const contentRef = useRef<HTMLDivElement>(null);
  const tailRef = useRef<HTMLDivElement>(null);
  const capacity = useBoardPageCapacity(contentRef);
  const { data, loading, error, errorPhase, loadMore, refresh, retry } = useDiscoverBoard(boardId, discoverBoardAdapter, capacity);
  const board = data?.board || discoverBoardById(boardId);
  const navigate = useNavigate();
  const theme = useTheme();
  const view = discoverPresentationView(theme);
  const covers = useCovers((data?.items || []).map(discoverCoverItem), active, true);
  const source = board ? boardSourceName(board) : '来源';
  const category = board?.category || board?.mediaType || 'movie';
  const categoryLabel = BOARD_CATEGORIES.find(option => option.id === category)?.label || '影片';
  useEffect(() => {
    if (!active || (!params.has('page') && !params.has('perPage'))) return;
    const next = new URLSearchParams(params); next.delete('page'); next.delete('perPage');
    setParams(next, { replace: true });
  }, [active, params, setParams]);
  useEffect(() => {
    if (!active || loading || error || !data?.hasMore || !tailRef.current || !contentRef.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) loadMore();
    }, { root: contentRef.current, rootMargin: '0px 0px 400px 0px' });
    observer.observe(tailRef.current);
    return () => observer.disconnect();
  }, [active, loading, error, data?.hasMore, data?.items.length, loadMore]);
  const openItem = (item: DiscoverItem) => { navigate(discoverDetailRoute(item)); };
  const complete = !!data && !data.hasMore && data.total !== null && data.items.length === data.total;
  return <div className="content board-content" ref={contentRef}>
    <nav className="board-breadcrumbs" aria-label="当前位置"><Link to="/boards"><Icon name="left" size={12} />榜单</Link></nav>
    <header className="page-heading board-heading"><div><h1>{board?.title || (error ? '榜单不可用' : '内容列表')}</h1></div>
      <div className="board-actions"><PosterSizeControl /><button className="gallery-icon-button" type="button" aria-label="刷新榜单" title="刷新榜单" disabled={loading} onClick={() => { covers.refresh(); refresh(); }}><Icon name="refresh" size={16} /></button>
        {board?.externalUrl && <a className="board-text-link" href={board.externalUrl} target="_blank" rel="noreferrer">原站<Icon name="globe" size={15} /></a>}
      </div>
    </header>
    <div className="board-list-toolbar"><div className="board-summary" aria-live="polite">
      <span className="board-source">{source}</span>
      {data && <span>{complete ? '共 ' + data.items.length + ' 部 · 完整榜单' : data.total === null ? '已加载 ' + data.items.length + ' 部' : '已加载 ' + data.items.length + ' 部 · 原站共 ' + data.total + ' 条记录'}</span>}
      {data && data.fetchedAt > 0 && <span>{data.stale ? '上次成功读取' : '数据读取于'} <time dateTime={new Date(data.fetchedAt).toISOString()}>{new Date(data.fetchedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></span>}
    </div></div>
    {data?.stale && <output className="banner">正在显示缓存内容，数据可能已变化。可刷新榜单或查看原站。</output>}
    {data?.notice && <output className="banner">{data.notice}</output>}
    {error && (!data || errorPhase === 'refresh') && <div className="board-error" role="alert"><p>{error}</p><button type="button" disabled={loading} onClick={retry}>{errorPhase === 'refresh' ? '重试刷新' : '重试加载'}</button>{board?.provider === 'tmdb' && <Link to="/config?section=meta">检查元数据设置</Link>}</div>}
    <section aria-label="榜单影片" aria-busy={loading}>
      {loading && !data ? <output className="empty"><span className="spinner" aria-hidden="true" />正在加载榜单…</output>
        : data?.items.length ? <div className="grid board-items">{data.items.map((item, index) => <DiscoverItemCard key={String(item.doubanId || item.tmdbId || item.title) + '-' + index}
          it={item} poster={covers.picOf(discoverCoverItem(item))} onError={url => covers.onError(discoverCoverItem(item), url)} onOpen={() => openItem(item)} card={view.card} ratingLabel={source + '评分'} />)}</div>
          : !error && !loading ? <div className="empty"><h2>榜单暂未返回影片</h2><button type="button" onClick={refresh}>重新加载</button></div> : null}
    </section>
    {data && data.items.length > 0 && <div className="board-feed-tail" ref={tailRef}>
      {loading ? <output className="board-feed-status" aria-live="polite"><span className="spinner" aria-hidden="true" />正在加载更多…</output>
        : error && errorPhase !== 'refresh' ? <div className="board-feed-error" role="alert"><span>{error}</span><button type="button" onClick={retry}>重试加载</button></div>
          : data.hasMore ? <button type="button" onClick={loadMore}>加载更多影片</button>
            : <><output className="board-feed-status">{complete ? '已显示全部 ' + data.items.length + ' 部' : '已到列表末尾'}</output><Link className="board-continue-link" to={'/?media=' + encodeURIComponent(category)}>浏览更多{categoryLabel}<Icon name="right" size={14} /></Link></>}
    </div>}
  </div>;
}

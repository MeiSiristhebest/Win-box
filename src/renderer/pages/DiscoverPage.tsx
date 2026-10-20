import PosterSizeControl from '../components/PosterSizeControl';
// src/renderer/pages/DiscoverPage.tsx — 发现页（★ 2026-09-24 起为**默认首页**，侧边栏第一个）
// 内容：
//   ① 推荐（豆瓣电影/剧集五分区；主进程持久缓存，过期后台更新）
//   ② 分类（国内标签推荐分页，与 TMDB 类型 ID 解耦）
// 交互：点任意影片 → 走 `#/search?agg=<片名>` 用「源」做一次全源搜索（没源时提示去导入）。
import { useEffect, useRef, useState } from 'react';
import { usePageActive } from '../lib/keepAlive';
import ItemCard, { discoverCoverItem } from '../components/DiscoverItemCard';
import '../features/discovery/boards.css';
import PluginSlot from '../components/PluginSlot';
import { openSearchWindow } from '../lib/searchWin';
import { useAppDialog } from '../components/AppDialog';
import { useTheme } from '../lib/theme';
import { discoverPresentationView } from '../lib/presentationRegistry';
import DiscoverShelf from '../components/DiscoverShelf';
import { Icon } from '../components/ui/Icon';
import { useCovers } from '../lib/useCovers';
import { useDiscoverController } from '../features/discovery/useDiscoverController';
import { useDiscoverExplore } from '../features/discovery/useDiscoverExplore';
import CascadeBar from '../components/CascadeBar';

export default function DiscoverPage() {
  const dialog = useAppDialog();
  const active = usePageActive();
  const contentRef = useRef<HTMLDivElement>(null);
  const tailRef = useRef<HTMLDivElement>(null);
  const theme = useTheme();
  const view = discoverPresentationView(theme);
  const isPosterWall = view.mode === 'poster-wall';
  const { sections, err, loading, retry } = useDiscoverController();
  const {
    media, mediaOpt: gSel, items: gItems, hasMore: gHasMore,
    loading: gLoading, error: genreError, errorPhase: gErrorPhase, levels, loadMore: gLoadMore, retryPage: gRetry, refreshPage: gRefresh, onPick: explorePick,
  } = useDiscoverExplore(retry);
  useEffect(() => {
    if (!active || media === null || gLoading || genreError || !gHasMore || !tailRef.current || !contentRef.current) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) gLoadMore(); }, { root: contentRef.current, rootMargin: '0px 0px 400px 0px' });
    observer.observe(tailRef.current);
    return () => observer.disconnect();
  }, [active, media, gLoading, genreError, gHasMore, gItems.length, gLoadMore]);
  /** ★ 2026-10-08（豆风）：海报墙当前分区（顶部 pill 切换 —— 替代「一行行横滑」的堆叠布局） */
  const [wallSec, setWallSec] = useState(0);
  const coverItem = discoverCoverItem;
  const covers = useCovers((gSel ? gItems : (view.mode === 'poster-wall' ? sections?.[wallSec]?.items || [] : sections?.flatMap(s => s.items) || [])).map(coverItem), active, true);

  const goSearch = (title: string): void => { void openSearchWindow(title).catch((e) => void dialog.alert(String(e), { title: '无法打开搜索窗口' })); };
  return (
    <>
      <div className="content discover-content" ref={contentRef}>
        <header className="page-heading discover-page-heading">
          <div className="discover-heading-title"><h1>发现</h1>{!err && sections?.some(section => section.stale) && <span className="discover-cache-state" title="部分推荐来自缓存，可刷新更新">缓存内容</span>}</div>
          <div className="discovery-heading-actions"><PosterSizeControl /><button className="gallery-icon-button" type="button" aria-label={media === null ? '刷新推荐' : '刷新分类'} title={media === null ? '刷新推荐' : '刷新分类'} disabled={media === null ? loading : gLoading} onClick={() => { covers.refresh(); if (media === null) retry(); else gRefresh(); }}><Icon name="refresh" size={16} /></button></div>
        </header>
        <nav className="browse-tabs discover-browse-tabs" aria-label="发现分类">
          <button type="button" className="browse-tab" aria-pressed={media === null} onClick={() => { if (media !== null) explorePick('media', media); }}>推荐</button>
          {levels[0].options.map(option => <button type="button" key={option.id} className="browse-tab" aria-pressed={media === option.id} onClick={() => { if (media !== option.id) explorePick('media', option.id); }}>{option.label}</button>)}
        </nav>
        {media !== null && <div className="discover-filter-panel"><CascadeBar levels={levels.slice(1)} onPick={explorePick} /></div>}
        <PluginSlot slot="discover" />
        {genreError && gItems.length > 0 && gErrorPhase === 'refresh' && <div className="board-error" role="alert"><span>{genreError}</span><button type="button" onClick={gRetry}>重试刷新</button></div>}
        {err && !!sections?.length && <output className="banner">{err}，正在保留已加载的推荐。</output>}
        {gSel ? (
          <>
            {gLoading && gItems.length === 0 ? (
              <div className="empty"><span className="spinner" aria-hidden="true" />加载中…</div>
            ) : gItems.length === 0 ? (
              <div className="empty">{genreError || '该分类暂无数据'} <button onClick={gRetry}>重试</button></div>
            ) : (
              <>
                <div className="grid" aria-busy={gLoading}>
                  {gItems.map((it, i) => (
                    <ItemCard key={`${it.title}-${i}`} it={it} poster={covers.picOf(coverItem(it))} onError={url => covers.onError(coverItem(it), url)} onOpen={() => goSearch(it.title)} card={view.card} />
                  ))}
                </div>
                <div className="board-feed-tail" ref={tailRef}>
                  {gLoading ? <output className="board-feed-status" aria-live="polite"><span className="spinner" aria-hidden="true" />正在加载更多…</output>
                    : genreError && gErrorPhase !== 'refresh' ? <div className="board-feed-error" role="alert"><span>{genreError}</span><button type="button" onClick={gRetry}>重试加载</button></div>
                      : gHasMore ? <button type="button" onClick={gLoadMore}>加载更多影片</button>
                        : <output className="board-feed-status">已到当前分类末尾 · 已加载 {gItems.length} 部</output>}
                </div>
              </>
            )}
          </>
        ) : loading && !sections ? (
          <div className="empty"><span className="spinner" aria-hidden="true" />加载中…</div>
        ) : err && (!sections || sections.length === 0) ? (
          <div className="err">
            {err}
            <button
              style={{ marginLeft: 10 }}
              onClick={retry}
            >
              重试
            </button>
          </div>
        ) : (
          /* ★ 2026-10-08（豆风）：**海报墙** —— 分区 pill（豆瓣「热门电影/热播剧集」那排）切换，
             下面一屏海报网格（悬停浮出播放钮 + 左下角年份角标）；不再是一行行横向滚动。 */
          isPosterWall ? (
            <div className={view.wall.containerClass}>
              <div className={view.wall.chipListClass} key={`chips-${sections?.length || 0}`}>
                {(sections || []).map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`${view.wall.chipClass}${i === wallSec ? ' active' : ''}`}
                    onClick={() => setWallSec(i)}
                  >
                    {s.title}
                  </button>
                ))}
              </div>
              <div className={view.wall.gridClass} key={`wall-${wallSec}`}>
                {((sections || [])[Math.min(wallSec, Math.max(0, (sections || []).length - 1))]?.items || []).map((it, i) => (
                  <ItemCard key={`${it.title}-${i}`} it={it} poster={covers.picOf(coverItem(it))} onError={url => covers.onError(coverItem(it), url)} onOpen={() => goSearch(it.title)} card={view.card} />
                ))}
              </div>
            </div>
          ) : (
            (sections || []).map((s) => (
              <DiscoverShelf key={s.id} boardId={s.browseId || s.id} title={s.title} count={s.items.length} view={view.row}>
                  {s.items.map((it, i) => {
                    const key = `${it.title}-${i}`;
                    const card = <ItemCard
                      key={key}
                      it={it}
                      poster={covers.picOf(coverItem(it))}
                      onError={url => covers.onError(coverItem(it), url)}
                      onOpen={() => goSearch(it.title)}
                      card={view.card}
                    />;
                    return view.row.cardWidth !== undefined
                      ? <div key={key} style={{ flex: `0 0 var(--poster-width, ${view.row.cardWidth}px)`, minWidth: 0 }}>{card}</div>
                      : card;
                  })}
              </DiscoverShelf>
            ))
          )
        )}
      </div>
    </>
  );
}

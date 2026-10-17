// src/renderer/pages/DiscoverPage.tsx — 发现页（★ 2026-09-24 起为**默认首页**，侧边栏第一个）
// 内容：
//   ① 推荐（豆瓣电影/剧集五分区；主进程持久缓存，过期后台更新）
//   ② 分类（国内标签推荐分页，与 TMDB 类型 ID 解耦）
// 交互：点任意影片 → 走 `#/search?agg=<片名>` 用「源」做一次全源搜索（没源时提示去导入）。
import { useState } from 'react';
import { openSearchWindow } from '../lib/searchWin';
import { useAppDialog } from '../components/AppDialog';
import { useTheme } from '../lib/theme';
import { discoverPresentationView } from '../lib/presentationRegistry';
import HScrollRow from '../components/HScrollRow';
import { useCovers } from '../lib/useCovers';
import type { DiscoverItem } from '../../shared/types';
import { useDiscoverController } from '../features/discovery/useDiscoverController';
import { useDiscoverExplore } from '../features/discovery/useDiscoverExplore';
import CascadeBar from '../components/CascadeBar';
import DiscoverSpotlight from '../components/DiscoverSpotlight';

/** 影片卡供推荐和分类结果共用。点击后按片名搜索全部来源。 */
function ItemCard({ it, poster, onError, onOpen, card }: {
  it: DiscoverItem;
  poster: string;
  onError: (url: string) => void;
  onOpen: () => void;
  card: { hoverPlayClass: string | null; hoverPlaySize: number; yearBadge: boolean; yearBadgeClass: string };
}) {
  return (
    <button
      type="button"
      className="card-media ui-action card-media-button"
      style={{ cursor: 'pointer' }}
      aria-label={`${it.title}${it.year ? ` (${it.year})` : ''}，点击全源搜索`}
      onClick={onOpen}
      title={`${it.title}${it.year ? ` (${it.year})` : ''} · 点击全源搜索`}
    >
      <div className="card">
        <div style={{ position: 'relative' }}>
          {poster ? <img src={poster} alt={it.title} loading="lazy" decoding="async" onError={e => onError(e.currentTarget.getAttribute('src') || '')} /> : <div className="no-cover">暂无封面</div>}
          {card.hoverPlayClass && (
            <span className={card.hoverPlayClass} aria-hidden="true">
              <svg width={card.hoverPlaySize} height={card.hoverPlaySize} viewBox="0 0 16 16"><path d="M5 3v10l8-5-8-5Z" fill="currentColor" /></svg>
            </span>
          )}
          {card.yearBadge && it.year
            ? <span className={['badge', card.yearBadgeClass].filter(Boolean).join(' ')}>{it.year}</span>
            : null}
        </div>
        <div className="meta">
          <div className="name" title={it.title}>{it.title}</div>
          {it.year && !card.yearBadge ? <div className="remarks">{it.year}</div> : null}
        </div>
      </div>
    </button>
  );
}

export default function DiscoverPage() {
  const dialog = useAppDialog();
  const theme = useTheme();
  const view = discoverPresentationView(theme);
  const isPosterWall = view.mode === 'poster-wall';
  const { sections, err, loading, retry } = useDiscoverController();
  const {
    media, mediaOpt: gSel, items: gItems, page: gPage, totalPages: gTotal,
    loading: gLoading, error: genreError, levels, summary, fetchPage, backToRecommend, onPick: explorePick,
  } = useDiscoverExplore(retry);
  /** ★ 2026-10-08（豆风）：海报墙当前分区（顶部 pill 切换 —— 替代「一行行横滑」的堆叠布局） */
  const [wallSec, setWallSec] = useState(0);
  const coverItem = (it: DiscoverItem) => ({ id: String(it.doubanId || it.tmdbId || it.title), name: it.title, year: it.year ? String(it.year) : undefined, pic: it.poster });
  const covers = useCovers((gSel ? gItems : (view.mode === 'poster-wall' ? sections?.[wallSec]?.items || [] : sections?.flatMap(s => s.items) || [])).map(coverItem));

  const goSearch = (title: string): void => { void openSearchWindow(title).catch((e) => void dialog.alert(String(e), { title: '无法打开搜索窗口' })); };
  return (
    <>
      <div className="content">
        {/* ★ 2026-09-24（用户定稿）：原来那排「发现 ……… 【刷新】」整排删除（标题与刷新按钮都属冗余）；
            ★ 2026-09-26（用户指令）：无源时的「还没有导入任何源 —— 去导入源」提示条也整条删除。 */}
        {media === null && sections && sections.length > 0 && (
          <DiscoverSpotlight items={sections[0].items.slice(0, 12)} picOf={(item) => covers.picOf(coverItem(item))} onOpen={goSearch} landscape={view.spotlightLandscape} />
        )}
        <CascadeBar levels={levels} onPick={explorePick} />
        {gSel ? (
          <>
            <div className="row" style={{ marginBottom: 10 }}>
              <h3 style={{ margin: 0 }}>{summary}</h3>
              <div style={{ flex: 1 }} />
              <button style={{ flex: '0 0 auto' }} onClick={backToRecommend}>返回推荐</button>
            </div>
            {gLoading && gItems.length === 0 ? (
              <div className="empty"><span className="spinner" aria-hidden="true" />加载中…</div>
            ) : gItems.length === 0 ? (
              <div className="empty">{genreError || '该分类暂无数据'} <button onClick={() => fetchPage(gPage)}>重试</button></div>
            ) : (
              <>
                <div className="grid">
                  {gItems.map((it, i) => (
                    <ItemCard key={`${it.title}-${i}`} it={it} poster={covers.picOf(coverItem(it))} onError={url => covers.onError(coverItem(it), url)} onOpen={() => goSearch(it.title)} card={view.card} />
                  ))}
                </div>
                {gTotal > 1 && (
                  <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
                    <button disabled={gPage <= 1 || gLoading} onClick={() => fetchPage(gPage - 1)}>上一页</button>
                    <span className="status">{gPage} / {gTotal}</span>
                    <button disabled={gPage >= gTotal || gLoading} onClick={() => fetchPage(gPage + 1)}>下一页</button>
                  </div>
                )}
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
              <div key={s.id} className={view.row.containerClass} style={view.row.containerStyle}>
                <h3 className={view.row.titleClass} style={view.row.titleStyle}>{s.title}</h3>
                {/* 横向滚动条：滚轮在行内 → 横向滚动（见 HScrollRow）；行外空白 → 页面上下滚动 */}
                <HScrollRow
                  className={view.row.scrollClass}
                  style={view.row.scrollStyle}
                >
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
                      ? <div key={key} style={{ flex: `0 0 ${view.row.cardWidth}px`, minWidth: 0 }}>{card}</div>
                      : card;
                  })}
                </HScrollRow>
              </div>
            ))
          )
        )}
      </div>
    </>
  );
}

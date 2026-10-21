// src/renderer/pages/DetailPage.tsx — 详情页（返回键 + 播放源/集数/滚动记忆 + 回播放页可继续）
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router-dom';
import { detailRouteParams } from '../../shared/detailWin';
import { client } from '../api/client';
// ★ 2026-10-18 受限 UI 槽位（`contributes.ui.slot`）：宿主页面的槽位落点
import PluginSlot from '../components/PluginSlot';
import { openSearchWindow } from '../lib/searchWin';
import BackButton from '../components/BackButton';
import { isDetailWindow } from '../lib/detailWin';
import { uiMem, schedulePersist } from '../lib/uiMemory';
import type { Episode } from '../../shared/types';
import { useCovers } from '../lib/useCovers';
import HeroBackdrop from '../components/HeroBackdrop';
import { detailIsEmpty } from '../../engine/config/sourceKind';
import DriveBindModal from '../components/DriveBindModal';
import { useTheme } from '../lib/theme';
import { detailPresentationView } from '../lib/presentationRegistry';
import { useDetailDataController } from '../features/detail/useDetailDataController';
import { useDetailPlaybackController } from '../features/detail/useDetailPlaybackController';
import { DetailEpisodeList } from '../features/detail/DetailEpisodeList';
import { MovieSourcesPanel } from '../features/detail/MovieSourcesPanel';

/**
 * ★ 2026-09-29：本会话已因「该源无剧集详情」自动跳到全源搜索的 item（键 = `<key>:<id>`）。
 *   模块级（跨挂载保留）——用户从搜索结果返回时不再被重复跳转。
 */
// ★ 2026-10-17（用户要求）：收藏 —— 本片加入/移出收藏（列表页在 pages/FavoritesPage.tsx）
import { FAVORITES_EVENT, addFavorite, findFavorite, removeFavorite } from '../lib/favorites';

export default function DetailPage({
  onPlay,
}: {
  onPlay: (url: string, name: string, fromKey: string, id: string, meta?: { pic?: string; remarks?: string; sourceName?: string; title?: string; vodId?: string; episodes?: Episode[]; epIndex?: number; flag?: string; profileId?: string }) => void;
}) {
  const routerParams = useParams<{ key: string; id: string }>();
  const location = useLocation();
  const { key, id } = detailRouteParams(location.pathname) || routerParams;
  const [searchParams] = useSearchParams();
  const requestedProfileId = searchParams.get('profileId') || '';
  const routeKey = `${key || ''}\u0000${id || ''}\u0000${requestedProfileId}`;
  const {
    profileId,
    memKey,
    detail,
    flag,
    setFlag,
    ep,
    setEp,
    epPage,
    setEpPage,
    loading,
    err,
    setErr,
    busy,
    setBusy,
    playGenRef,
  } = useDetailDataController({ key, id, requestedProfileId, routeKey });
  /** ★ 2026-10-08（用户要求「详情页独立窗口」）：本页是否运行在独立详情窗口里（hash 带 dw=1）→ 返回=关窗 */
  const isDetailWin = isDetailWindow();
  const theme = useTheme();
  const presentation = detailPresentationView(theme);
  // 从列表页经 URL query 携带的封面（fty 等源 detail 接口偶发不返回 vod_pic，用作兜底）
  const fromListPic = searchParams.get('pic') || '';
  /** ★ 2026-09-24：列表页带过来的片名 —— 「立播」等源详情接口不返回 vod_name，用它兜底 */
  const fromListName = searchParams.get('name') || '';
  /**
   * ★ 2026-09-30（用户要求）：剧集列表**分页** —— 每页至多 `EP_PAGE_SIZE`（50）集，多的翻页展示。
   *   页码只为浏览用；选中集 `ep` 始终是**全局下标**（播放/高亮/记忆都不受翻页影响）。
   */
  /**
   * ★ 2026-09-29（用户要求）：解析到**网盘专用链接但未绑定 Cookie** → 直接弹「网盘绑定」窗口（预选该网盘）。
   * 主进程此时已把这次播放拦下（`parse:1` + `needDriveCookieBind`，不给必失败的直链）。
   */
  const [bindProvider, setBindProvider] = useState('');
  /** ★ 2026-09-24：播放（可能含解析/嗅探）进行中 → 按钮上屏进度 */
  const contentRef = useRef<HTMLDivElement>(null);
  /** ★ 2026-09-24：展示用片名 —— 详情自带优先，缺失时用列表页带入的（立播等源详情不返回 vod_name） */
  const displayName = (detail?.name || fromListName || '').trim();
  /** 无可播剧集时搜索用片名：去掉「 - 副标题」尾巴 */
  const detailName = displayName.split(' - ')[0]?.trim() || '';
  const { chooseFlag, chooseEp, play } = useDetailPlaybackController({
    key,
    id,
    profileId,
    memKey,
    detail,
    displayName,
    flag,
    setFlag,
    ep,
    setEp,
    setEpPage,
    busy,
    setBusy,
    setErr,
    contentRef,
    playGenRef,
    onPlay,
    onNeedDriveCookieBind: setBindProvider,
  });

  /**
   * ★ 2026-10-17（用户要求）：收藏状态。
   *   · 收藏键含「订阅档案 id」（同订阅同源同片一条）→ 先取当前档案；
   *   · 状态订阅 `winbox:favorites-changed`：在收藏页移除后回到本页会即时同步。
   */
  const [favMeta, setFavMeta] = useState<{ profileId: string; sourceName: string }>({ profileId: '', sourceName: '' });
  const [favOn, setFavOn] = useState(false);
  useEffect(() => {
    let alive = true;
    client
      .cfgGet()
      .then((cfg) => {
        if (!alive) return;
        setFavMeta({ profileId: profileId || cfg.activeProfileId, sourceName: cfg.sources.find((s) => s.key === key)?.name || '' });
      })
      .catch(() => undefined);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, profileId]);
  useEffect(() => {
    const sync = (): void =>
      setFavOn(findFavorite({ sourceKey: key, vodId: id, name: displayName, profileId: favMeta.profileId }) !== null);
    sync();
    window.addEventListener(FAVORITES_EVENT, sync);
    return () => window.removeEventListener(FAVORITES_EVENT, sync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, id, displayName, favMeta.profileId]);

  /** 收藏 / 取消收藏（按当前档案；无 key/id 时按钮禁用） */
  const toggleFavorite = async (): Promise<void> => {
    if (!key || !id) return;
    const ref = { sourceKey: key, vodId: id, name: displayName, profileId: favMeta.profileId };
    const hit = findFavorite(ref);
    if (hit) {
      removeFavorite(hit.key);
      setFavOn(false);
      return;
    }
    addFavorite({
      name: displayName || detailName,
      sourceKey: key,
      vodId: id,
      profileId: favMeta.profileId || undefined,
      sourceName: favMeta.sourceName || undefined,
      pic: detail?.pic || fromListPic || undefined,
      remarks: detail?.remarks || undefined,
      year: detail?.year || undefined,
      type: detail?.type || undefined,
    });
    setFavOn(true);
  };


  // 图片补全独立于源详情和播放状态，任何失败都不阻塞选集与播放。
  const coverItem = { id: memKey, name: detailName, year: detail?.year || undefined, pic: detail?.pic || fromListPic || '' };
  const covers = useCovers([coverItem], !loading);
  const cover = covers.picOf(coverItem);
  const coverErr = (e: React.SyntheticEvent<HTMLImageElement>) => covers.onError(coverItem, e.currentTarget.getAttribute('src') || '');
  const [backdrop, setBackdrop] = useState<{ key: string; urls: string[] } | null>(null);
  const showBackdrop = presentation.backdrop.enabled;
  useEffect(() => {
    if (loading || !detailName || !showBackdrop) return;
    let alive = true;
    void client.metaDiscoverImages(detailName, /剧|tv/i.test(detail?.type || '') ? 'tv' : 'movie', detail?.year || undefined, 'backdrop')
      .then(images => { if (alive) setBackdrop({ key: memKey, urls: images.backdrops }); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [loading, detailName, detail?.year, detail?.type, memKey, showBackdrop]);

  // 滚动位置记忆
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const onScroll = () => {
      const mem = uiMem.detail.get(memKey);
      uiMem.detail.set(memKey, { flag, ep, scrollTop: el.scrollTop });
      if (mem && mem.scrollTop !== el.scrollTop) void 0;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { el.removeEventListener('scroll', onScroll); schedulePersist(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memKey, flag, ep]);

  // 数据就绪后恢复滚动位置
  useLayoutEffect(() => {
    const mem = uiMem.detail.get(memKey);
    if (mem && mem.scrollTop && contentRef.current) {
      contentRef.current.scrollTop = mem.scrollTop;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, memKey]);

  // 页码保存在详情控制器中；列表组件负责分页展示，选择集数始终使用全局下标。
  const epAll = detail?.episodes[flag] || [];

  const castList: Array<{ name: string }> = (detail?.actor || '')
    .split(/[,，/、;；|]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 24)
    .map((name) => ({ name }));
  const directorText = (detail?.director || '').trim();
  const actorText = (detail?.actor || '').trim();
  const introText = (detail?.des || '').trim();
  /** 点击源提供的演员 → 对该关键词执行一次全源搜索。 */
  const goSearch = (kw: string): void => { void openSearchWindow(kw, profileId || undefined).catch((e) => setErr(String(e))); };

  /**
   * ★ 2026-10-17（用户要求）：收藏按钮 —— 操作区与「该源无资源」两个分支都渲染它
   *   （独立详情窗口不渲染 topbar，故不放顶栏；两分支都可见才不会被漏掉）。
   */
  const favoriteBtn = (
    <button
      type="button"
      className={`fav-btn${favOn ? ' active' : ''}`}
      disabled={!key || !id}
      aria-pressed={favOn}
      title={favOn ? '取消收藏' : '加入收藏（在「收藏」页查看）'}
      onClick={() => { void toggleFavorite(); }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill={favOn ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" />
      </svg>
      {favOn ? '已收藏' : '收藏'}
    </button>
  );

  return (
    <>
      {/* ★ 2026-09-29：网盘未绑定 → 自动弹出绑定向导（预选该网盘）；绑定成功即自动重播 */}
      {bindProvider && (
        <DriveBindModal
          siteName={displayName || '当前源'}
          initialProvider={bindProvider}
          onClose={() => setBindProvider('')}
          onSaved={() => { setBindProvider(''); void play(); }}
        />
      )}
      {/* ★ 2026-10-08（用户要求「独立详情页这个横条取消掉，上方已经有小按钮可以独立关闭了」）：
          独立详情窗口**整条不渲染**（关闭走窗口标题栏的 ✕；键盘 Alt+←/Backspace 亦可，
          见 App.goBack 的 dw 分支；片名正文里已有 h2 标题）。主窗口内保持原样。 */}
      {!isDetailWin && (
        <div className="topbar">
          <BackButton fallback="/home" label="返回列表" />
          <span className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</span>
        </div>
      )}
      <div className={['content', presentation.contentClass].filter(Boolean).join(' ')} ref={contentRef}>
        <PluginSlot slot="detail" />
        {loading ? (
          <div className="empty"><span className="spinner" aria-hidden="true" />加载中…</div>
        ) : err ? (
          <div className="err">{err}</div>
        ) : !detail ? (
          <div className="empty">无详情</div>
        ) : (
          <>
            {backdrop?.key === memKey && backdrop.urls.length > 0 && presentation.backdrop.enabled && (
              <div
                className={presentation.backdrop.className}
                style={presentation.backdrop.absolute ? { position: 'absolute' } : undefined}
                aria-hidden="true"
              >
                <HeroBackdrop urls={backdrop.urls} />
              </div>
            )}
            <div className={presentation.hero.className} style={presentation.hero.layoutStyle}>
              {/** 封面不使用图片搜索；横版背景独立加载。 */}
              {cover ? (
                <img
                  src={cover}
                  alt={displayName}
                  className={presentation.hero.posterClass || undefined}
                  style={presentation.hero.posterStyle}
                  onError={coverErr}
                />
              ) : (
                <div
                  className={presentation.hero.noCoverClass || undefined}
                  style={presentation.hero.noCoverStyle}
                >暂无封面</div>
              )}
              <div style={presentation.hero.infoStyle} className={presentation.hero.infoClass || undefined}>
                <h2
                  className={presentation.hero.titleClass || undefined}
                  style={presentation.hero.titleStyle}
                >{displayName}</h2>
                <div className="muted" style={{ marginBottom: 4 }}>{detail.type} · {detail.year} · {detail.area}</div>
                {directorText && <div className="muted" style={{ marginBottom: 4 }}>导演：{directorText}</div>}
                {actorText && <div className="muted" style={{ marginBottom: 4 }}>主演：{actorText}</div>}
                {detail.remarks && (
                  <div
                    className={presentation.hero.remarksClass || undefined}
                    style={presentation.hero.remarksStyle}
                  >{detail.remarks}</div>
                )}
                <div
                  className={presentation.hero.introClass}
                  style={presentation.hero.introStyle}
                >
                  {introText}
                </div>
              </div>
            </div>
            {/* ★ 2026-10-15（用户要求「点播页点击后，优先匹配该源的资源，没有再提示…」）：
                该源没有可播剧集（豆瓣类/搜索聚合源/源侧 jar 自校验失败）→ **问一句**是否进入聚合搜索
                （此前是 1.2s 后自动跳转，现已改为用户确认，避免"莫名其妙被换页"）。 */}
            {detail.flags.length > 0 && !detailIsEmpty(detail) ? (
              <>
                <div className="row" style={{ marginBottom: 10 }}>
                  <span className="muted">播放源：</span>
                  {detail.flags.map((f) => (
                    <button type="button" key={f} className={`tag ui-action ${f === flag ? 'active' : ''}`} aria-pressed={f === flag} onClick={() => chooseFlag(f)}>{f}</button>
                  ))}
                </div>
                {/* 每组至多 50 集，直接选择区间；浏览区间不会改变当前选中集。 */}
                {presentation.hero.showSectionHeading && (
                  <div className={presentation.hero.sectionHeadingClass}>选集</div>
                )}
                <DetailEpisodeList
                  episodes={epAll}
                  page={epPage}
                  selectedEpisode={ep}
                  onPageChange={setEpPage}
                  onChooseEpisode={chooseEp}
                  onPlayEpisode={(index) => { void play(index); }}
                />
                <div className="row" style={{ marginTop: 14, alignItems: 'center' }}>
                  <button className={presentation.playButtonClass} disabled={busy} onClick={() => { void play(); }}>
                    {busy ? '正在解析播放地址…' : '▶ 播放选中'}
                  </button>
                  {favoriteBtn}
                </div>
              </>
            ) : (
              <div className="row" style={{ marginTop: 12, flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 13 }}>该源没有「{detailName || detail.name || ''}」的资源，是否进入聚合搜索？</span>
                <button className={presentation.playButtonClass} onClick={() => goSearch(detailName || detail.name || '')}>
                  进入聚合搜索
                </button>
                {favoriteBtn}
              </div>
            )}
            {castList.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div className="muted" style={{ marginBottom: 6 }}>演员（点击搜索 TA 的作品）</div>
                <div className="row">
                  {castList.map((c) => (
                    <button
                      type="button"
                      key={c.name}
                      className="tag ui-action"
                      title="点击全源搜索"
                      onClick={() => goSearch(c.name)}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
        {detailName && <MovieSourcesPanel title={detailName} />}
      </div>
    </>
  );
}

// src/renderer/pages/DetailPage.tsx — 详情页（返回键 + 播放源/集数/滚动记忆 + 回播放页可继续）
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { detailRouteParams } from '../../shared/detailWin';
import { client } from '../api/client';
import { openSearchWindow } from '../lib/searchWin';
import BackButton from '../components/BackButton';
import { isDetailWindow } from '../lib/detailWin';
import { uiMem, schedulePersist } from '../lib/uiMemory';
import type { Episode, VodDetail } from '../../shared/types';
import { playbackResultError } from '../../shared/playbackResult';
import { useCovers } from '../lib/useCovers';
import HeroBackdrop from '../components/HeroBackdrop';
import { formatEpisodeLabel } from '../lib/epName';
import { EP_PAGE_SIZE, epPageRanges, epPageSlice } from '../lib/epPager';
import { makeStaleGuard } from '../lib/staleGuard';
import { detailIsEmpty } from '../../engine/config/sourceKind';
import DriveBindModal from '../components/DriveBindModal';
import { useTheme } from '../lib/theme';
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
  const nav = useNavigate();
  /** ★ 2026-10-08（用户要求「详情页独立窗口」）：本页是否运行在独立详情窗口里（hash 带 dw=1）→ 返回=关窗 */
  const isDetailWin = isDetailWindow();
  /** ★ 2026-09-24：Netflix 皮肤下详情页用「大图背景 + 大标题 + 白色播放键」的影院式排版
   *  ★ 2026-09-29：Apple 皮肤用同源剧照背景，但排版走 Apple TV 影片页观感（玻璃信息卡 + 蓝色胶囊播放键） */
  const nf = useTheme() === 'netflix';
  const ap = useTheme() === 'apple';
  /** ★ 2026-10-08（豆风）：豆瓣式影片页 —— 左侧大海报 + 右侧信息区（简介/演职员/操作），
   *   下方「播放源 / 选集 / 类型 / 演员 / 相关推荐」都走浅色 M3 卡片（见 douban.css 的 .db-detail 组）。 */
  const db = useTheme() === 'douban';
  // 从列表页经 URL query 携带的封面（fty 等源 detail 接口偶发不返回 vod_pic，用作兜底）
  const fromListPic = searchParams.get('pic') || '';
  /** ★ 2026-09-24：列表页带过来的片名 —— 「立播」等源详情接口不返回 vod_name，用它兜底 */
  const fromListName = searchParams.get('name') || '';
  const [detail, setDetail] = useState<VodDetail | null>(null);
  const [flag, setFlag] = useState('');
  const [ep, setEp] = useState(0);
  /**
   * ★ 2026-09-30（用户要求）：剧集列表**分页** —— 每页至多 `EP_PAGE_SIZE`（50）集，多的翻页展示。
   *   页码只为浏览用；选中集 `ep` 始终是**全局下标**（播放/高亮/记忆都不受翻页影响）。
   */
  const [epPage, setEpPage] = useState(0);
  /** 剧集列表容器（翻页后把新页开头带回视野） */
  const epListRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  /**
   * ★ 2026-09-29（用户要求）：解析到**网盘专用链接但未绑定 Cookie** → 直接弹「网盘绑定」窗口（预选该网盘）。
   * 主进程此时已把这次播放拦下（`parse:1` + `needDriveCookieBind`，不给必失败的直链）。
   */
  const [bindProvider, setBindProvider] = useState('');
  /** ★ 2026-09-24：播放（可能含解析/嗅探）进行中 → 按钮上屏进度 */
  const [busy, setBusy] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  /**
   * ★ 2026-09-28 修复「旧解析的超时晚到把新播放窗口顶掉」：解析请求**代数**。
   *
   * 慢源（加固壳 / 网盘转存）的 `client.play()` 可挂几十秒到 300s；用户换源 / 换集后再点播放，
   * 旧请求回来时会无条件 `onPlay()` → 单例播放器窗口被 `player:init` 顶成**旧**内容。
   * 现在：每次点击播放 / 换线路换集 / 换详情都 ++；晚到的旧结果一律丢弃（不打开窗口、不报错、不动 busy）。
   */
  const playGenRef = useRef(makeStaleGuard());
  /** 本次解析对应的「意图」（源|线路|集）：同一意图的重复点击仍按老行为忽略，避免慢源被连点两次解析 */
  const playIntentRef = useRef('');
  // 原始 pathname 只解码一次；不要再次 decode 路由参数。
  const memKey = `${key || ''}:${id || ''}`;
  /** ★ 2026-09-24：展示用片名 —— 详情自带优先，缺失时用列表页带入的（立播等源详情不返回 vod_name） */
  const displayName = (detail?.name || fromListName || '').trim();
  /** 无可播剧集时搜索用片名：去掉「 - 副标题」尾巴 */
  const detailName = displayName.split(' - ')[0]?.trim() || '';

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
        setFavMeta({ profileId: cfg.activeProfileId, sourceName: cfg.sources.find((s) => s.key === key)?.name || '' });
      })
      .catch(() => undefined);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
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

  useEffect(() => {
    if (!key || !id) return;
    const k = key;
    const i = id;
    let alive = true;
    setDetail(null);
    setLoading(true);
    setErr('');
    playGenRef.current.next(); // ★ 换了一部片 → 上一条解析作废（并放开 busy，避免按钮被旧请求卡住）
    setBusy(false);
    client
      .detail({ key: k, ids: [i] })
      .then((d) => {
        if (!alive) return;
        setDetail(d);
        if (d && d.flags.length) {
          // 恢复上次选择的播放源/集数（若仍在范围）
          const mem = uiMem.detail.get(memKey);
          const f = mem && d.flags.includes(mem.flag) ? mem.flag : d.flags[0];
          const eps = d.episodes[f] || [];
          const e = mem && mem.ep >= 0 && mem.ep < eps.length ? mem.ep : 0;
          setFlag(f);
          setEp(e);
          setEpPage(Math.floor(e / EP_PAGE_SIZE)); // 恢复的选中集可能在后几页 → 翻到它所在的页
          uiMem.detail.set(memKey, { flag: f, ep: e, scrollTop: mem?.scrollTop ?? 0 });
        }
      })
      .catch((e) => { if (alive) setErr((e as Error).message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; playGenRef.current.next(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, id]);

  // 图片补全独立于源详情和播放状态，任何失败都不阻塞选集与播放。
  const coverItem = { id: memKey, name: detailName, year: detail?.year || undefined, pic: detail?.pic || fromListPic || '' };
  const covers = useCovers([coverItem], !loading);
  const cover = covers.picOf(coverItem);
  const coverErr = (e: React.SyntheticEvent<HTMLImageElement>) => covers.onError(coverItem, e.currentTarget.getAttribute('src') || '');
  const [backdrop, setBackdrop] = useState<{ key: string; urls: string[] } | null>(null);
  useEffect(() => {
    if (loading || !detailName || !(nf || ap)) return;
    let alive = true;
    void client.metaDiscoverImages(detailName, /剧|tv/i.test(detail?.type || '') ? 'tv' : 'movie', detail?.year || undefined, 'backdrop')
      .then(images => { if (alive) setBackdrop({ key: memKey, urls: images.backdrops }); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [loading, detailName, detail?.year, detail?.type, memKey, nf, ap]);

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

  function chooseFlag(f: string) {
    playGenRef.current.next(); // ★ 换线路 = 播放意图变了 → 上一条解析作废
    setBusy(false);
    setFlag(f);
    setEp(0);
    setEpPage(0); // ★ 换线路 → 集列表变了，回到第一页
    uiMem.detail.set(memKey, { flag: f, ep: 0, scrollTop: contentRef.current?.scrollTop ?? 0 });
  }
  function chooseEp(i: number) {
    playGenRef.current.next(); // ★ 换集 = 播放意图变了 → 上一条解析作废
    setBusy(false);
    setEp(i);
    uiMem.detail.set(memKey, { flag, ep: i, scrollTop: contentRef.current?.scrollTop ?? 0 });
    schedulePersist();
    // 单击仅选择；播放按钮/双击才提交播放意图，不打断已打开的播放器。
  }

  // ★ 2026-09-30（用户要求）：剧集列表分页（每页至多 EP_PAGE_SIZE 集，页码越界自动夹取）
  const epAll = detail?.episodes[flag] || [];
  const epPaged = epPageSlice(epAll, epPage);
  /** 翻页：切换页码并把新页开头带回视野（翻页按钮在列表下方，不滚一下会停在新页末尾） */
  function goEpPage(p: number): void {
    setEpPage(p);
    requestAnimationFrame(() => epListRef.current?.scrollIntoView({ block: 'start' }));
  }

  async function play(index = ep) {
    if (!detail || !flag) return;
    const eps = detail.episodes[flag] || [];
    const target = eps[index];
    if (!target) return;
    // 同一意图（源|线路|集）重复点击：与旧行为一致地忽略，别让慢源被连点两次解析
    const intent = `${key}|${flag}|${index}`;
    if (busy && playIntentRef.current === intent) return;
    playIntentRef.current = intent;
    // ★ 2026-09-28：开一代；晚到的旧结果（换源/换集/再点一次之后）一律丢弃 —— 见 playGenRef 注释
    const gen = playGenRef.current.next();
    setErr('');
    // ★ parse=1 的地址要走「解析接口 → 隐藏窗口嗅探」，可能耗时十几秒 → 按钮上屏进度，别让用户以为没反应
    setBusy(true);
    try {
      // 在解析前捕获所属档案，不能在解析结束或进度回写时读取另一窗口已切换的订阅。
      const cfg = await client.cfgGet();
      if (!playGenRef.current.isCurrent(gen)) return;
      const r = await client.play({ key: key!, flag, id: target.url });
      if (!playGenRef.current.isCurrent(gen)) return; // 过期结果：不要顶掉用户后来选的播放
      // ★ 2026-09-29：网盘专用链接未绑定 Cookie → 弹绑定窗口（预选该网盘）；绑定成功后自动重播
      if (r.needDriveCookieBind) {
        setErr('');
        setBindProvider(String(r.needDriveCookieBind));
        return;
      }
      // parse=1（需网页解析/嗅探）：主进程已尽力（解析接口 → 隐藏窗口嗅探），仍拿不到直连地址才上屏原因
      const playError = playbackResultError(r);
      if (playError) {
        setErr(playError);
        return;
      }
      // ★ 网盘源集名过长 → 播放器标题/历史记录统一用「第N集 · 体积」
      const label = formatEpisodeLabel(target.name, index);
      onPlay(r.url, `${displayName} - ${label}`, key!, id!, {
        pic: detail.pic,
        remarks: label,
        sourceName: cfg.sources.find((s) => s.key === key)?.name || key,
        profileId: cfg.activeProfileId,
        title: displayName || undefined, // ★ 剧名副名（详情页主标题），供字幕检索使用，避免从集名反推失败
        vodId: detail.id,
        // 换集导航数据：完整集列表 + 当前集下标 + 播放源 flag
        episodes: detail.episodes[flag] || [],
        epIndex: index,
        flag,
      });
    } catch (e) {
      if (!playGenRef.current.isCurrent(gen)) return; // 过期失败：不把旧源的报错上屏
      setErr((e as Error).message);
    } finally {
      if (playGenRef.current.isCurrent(gen)) setBusy(false); // 已被更新的一代接管 → 不解除新请求的 busy
    }
  }

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
  const goSearch = (kw: string): void => { void openSearchWindow(kw).catch((e) => setErr(String(e))); };

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
      <div className={`content${nf ? ' nf-detail-wrap' : ap ? ' ap-detail-wrap' : db ? ' db-detail' : ''}`} ref={contentRef}>
        {loading ? (
          <div className="empty"><span className="spinner" aria-hidden="true" />加载中…</div>
        ) : err ? (
          <div className="err">{err}</div>
        ) : !detail ? (
          <div className="empty">无详情</div>
        ) : (
          <>
            {backdrop?.key === memKey && backdrop.urls.length > 0 && (nf || ap) && (
              <div className={nf ? 'nf-detail-backdrop' : 'ap-detail-backdrop'} style={nf ? { position: 'absolute' } : undefined} aria-hidden="true">
                <HeroBackdrop urls={backdrop.urls} />
              </div>
            )}
            {/* ★ 2026-10-08（豆风）：头图区 —— 大海报卡 + 信息区（豆瓣影片页布局；不再是「小图 + 右列文字」） */}
            <div className={db ? 'db-hero' : 'row'} style={db ? undefined : { alignItems: 'flex-start', gap: 16, marginBottom: 16 }}>
              {/** 封面不使用图片搜索；横版背景独立加载。 */}
              {cover ? (
                <img
                  src={cover}
                  className={db ? 'db-hero-poster' : undefined}
                  style={db ? undefined : { width: 120, aspectRatio: '2/3', objectFit: 'cover', borderRadius: 8, background: 'var(--bg-elev2)' }}
                  onError={coverErr}
                />
              ) : (
                <div
                  className={db ? 'db-hero-poster db-hero-nocover' : undefined}
                  style={{
                    width: db ? undefined : 120, aspectRatio: '2/3', borderRadius: db ? undefined : 8, background: 'var(--bg-elev2)', flex: 'none',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: 11,
                  }}
                >暂无封面</div>
              )}
              <div style={{ flex: 1, minWidth: 0 }} className={db ? 'db-hero-info' : undefined}>
                <h2 className={db ? 'db-hero-title' : undefined} style={db ? undefined : { margin: '0 0 8px' }}>{displayName}</h2>
                <div className="muted" style={{ marginBottom: 4 }}>{detail.type} · {detail.year} · {detail.area}</div>
                {directorText && <div className="muted" style={{ marginBottom: 4 }}>导演：{directorText}</div>}
                {actorText && <div className="muted" style={{ marginBottom: 4 }}>主演：{actorText}</div>}
                {detail.remarks && (db
                  ? <div className="db-remark-pill">{detail.remarks}</div>
                  : <div style={{ color: 'var(--accent-2)', marginBottom: 4 }}>{detail.remarks}</div>)}
                <div
                  className={db ? 'muted db-hero-intro' : 'muted'}
                  style={db ? { fontSize: 13, overflow: 'auto', marginTop: 8 } : { fontSize: 12, maxHeight: 80, overflow: 'auto', marginTop: 8 }}
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
                    <span key={f} className={`tag ${f === flag ? 'active' : ''}`} onClick={() => chooseFlag(f)}>{f}</span>
                  ))}
                </div>
                {/* 每组至多 50 集，直接选择区间；浏览区间不会改变当前选中集。 */}
                {db && <div className="db-sec-title">选集</div>}
                {epPaged.pageCount > 1 && (
                  <div className="quick-picks ep-ranges" role="group" aria-label="集数区间">
                    {epPageRanges(epAll.length).map((range) => (
                      <button key={range.page} className={`tag ${epPaged.page === range.page ? 'active' : ''}`}
                        aria-pressed={epPaged.page === range.page} onClick={() => goEpPage(range.page)}>
                        {range.label}
                      </button>
                    ))}
                  </div>
                )}
                <div className="ep-list" ref={epListRef}>
                  {epPaged.items.map((e, i) => {
                    const gi = epPaged.start + i; // 全局集下标：选择/高亮/播放都按它，翻页不影响已选集
                    return (
                      // ★ 2026-09-24：网盘源集名是一整串文件名 → 只展示「第N集 · 体积」（title 保留原名可悬停查看）
                      <div key={gi} className={`ep ${gi === ep ? 'active' : ''}`} onClick={() => chooseEp(gi)} onDoubleClick={() => { void play(gi); }} title={`${e.name || e.url}（单击选择，双击播放）`}>
                        {formatEpisodeLabel(e.name, gi)}
                      </div>
                    );
                  })}
                </div>
                <div className="row" style={{ marginTop: 14, alignItems: 'center', gap: 10 }}>
                  <button className={`primary${nf ? ' nf-play-btn' : ''}`} disabled={busy} onClick={() => { void play(); }}>
                    {busy ? '正在解析播放地址…' : '▶ 播放选中'}
                  </button>
                  {favoriteBtn}
                </div>
              </>
            ) : (
              <div className="row" style={{ marginTop: 12, flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 13 }}>该源没有「{detailName || detail.name || ''}」的资源，是否进入聚合搜索？</span>
                <button className={`primary${nf ? ' nf-play-btn' : ''}`} onClick={() => goSearch(detailName || detail.name || '')}>
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
                    <span
                      key={c.name}
                      className="tag"
                      title="点击全源搜索"
                      onClick={() => goSearch(c.name)}
                    >
                      {c.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

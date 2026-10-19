import { Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import TitleBar from './components/TitleBar';
import PageErrorBoundary from './components/PageErrorBoundary';
import { lazy, Suspense, useEffect, useState } from 'react';
import { KeepAliveRoutes } from './features/navigation/KeepAliveRoutes';
import { useLocation } from 'react-router-dom';
const ConfigPage = lazy(() => import('./pages/ConfigPage'));
const HomePage = lazy(() => import('./pages/HomePage'));
const DiscoverPage = lazy(() => import('./pages/DiscoverPage'));
const DetailPage = lazy(() => import('./pages/DetailPage'));
const PlayerPage = lazy(() => import('./pages/PlayerPage'));
const LivePage = lazy(() => import('./pages/LivePage'));
// ★ 2026-09-29：WebDAV 存储（只读浏览/播放）
const StoragePage = lazy(() => import('./pages/StoragePage'));
const HistoryPage = lazy(() => import('./pages/HistoryPage'));
const AboutPage = lazy(() => import('./pages/AboutPage'));
const ComponentShowcasePage = lazy(() => import('./pages/ComponentShowcasePage'));
const FavoritesPage = lazy(() => import('./pages/FavoritesPage'));
/** ★ 2026-09-29：启动更新提示（本地版本低于 GitHub 最新 Release 时由用户决定是否更新） */
import UpdateGate from './components/UpdateGate';
import { loadUiMemory, sameEpProgress, saveUiMemory, markHistoryOnlyWriter } from './lib/uiMemory';
import { MODIFIED_BUILD_DISCLAIMER } from './lib/disclaimerText';
// ★ 2026-10-17（用户要求）：收藏（独立 localStorage 键，不并入 uiMemory）
import { FAVORITES_EVENT, loadFavorites } from './lib/favorites';
// ★ 2026-09-30（用户要求）：显式绑定第三方播放器时点播直接由它播放（详见 lib/externalPlay.ts）
import { playVodExternal } from './lib/externalPlay';
import { useShowDiscover } from './lib/uiPrefs';
// 详情打开方式统一入口 + 固定窗口身份判定。
import { isDetailWindow, openDetailRoute } from './lib/detailWin';
import { isSearchWindow, bindSearchNav } from './lib/searchWin';
import { useTheme } from './lib/theme';
import { setImageFreezeActive } from './lib/freezeImages';
import { presentationFor } from './lib/themeTokens';
import { isNativeModalOpen } from './lib/modalScope';
import { client } from './api/client';
import { AppModal, useAppDialog } from './components/AppDialog';
import { APP_NAV_GROUPS, NAV, SHELL_PRESENTATIONS, ShellFrame } from './layouts/ShellLayouts';
// ★ 2026-10-18 插件快捷键（contributes.keymap）：app 作用域分发（动作复用 ui.command 词表）
import { usePluginKeymaps } from './lib/pluginKeymaps';
import { runPluginCommand } from './lib/pluginCommands';
import type { Episode } from '../shared/types';
import { PluginDialogBridge } from './features/plugins/PluginDialogBridge';

/**
 * ★ 2026-10-08（用户要求「详情页独立窗口」）：详情窗口与主窗口共享同一份 localStorage 的 uiMem，
 *   若整份写盘会把主窗口已清掉的状态复活（与播放器窗口同款问题，见 PlayerPage 顶部那段）。
 *   这里在**模块求值期**声明：本窗口只写历史与进度（任何页面挂载前的第一件事）。
 */
if (isDetailWindow() || isSearchWindow()) markHistoryOnlyWriter();

/**
 * 页面外壳（布局路由）：承载「页面切换过渡动画」。
 * ★ 2026-09-24（用户定稿）：以 pathname 为 key → 切页时容器重建并播放一次入场动画（淡入 + 轻微上移，苹果 / Netflix 式）。用布局路由 + Outlet 而非嵌套 Routes，
 *   避免相对路径解析问题；query 变化（如 HomePage 清 `?agg=`）不改 pathname → 不重播动画。
 */
function PageShell() {
  const loc = useLocation();
  return (
    <div className="page-anim" key={loc.pathname}>
      <PageErrorBoundary>
        <Suspense fallback={<RouteLoading />}>
          <Outlet />
        </Suspense>
      </PageErrorBoundary>
    </div>
  );
}

function RouteLoading() {
  return <output className="empty" aria-live="polite" style={{ padding: 32 }}>正在加载页面…</output>;
}

export default function App() {
  return (
    <UpdateGate>
      <PluginDialogBridge />
      <AppShell />
    </UpdateGate>
  );
}

function AppShell() {
  const dialog = useAppDialog();
  const nav = useNavigate();
  const loc = useLocation();
  // ★ 2026-10-15：把本窗口的导航函数交给搜索入口 —— 「单页内」模式下搜索在**本窗口内**跳转（伪墓碑）。
  useEffect(() => {
    bindSearchNav((to) => nav(to));
    return () => bindSearchNav(null);
  }, [nav]);
  /** ★ 2026-09-30（用户要求）：皮肤体系 —— 网飝 / 哔哔（都是「顶部导航一体化」外壳）+ 大果 / 豆风（各自独立外壳，见下）。
   *  两个经典主题（经典深/浅）与 sidebar 版式已删除。 */
  const theme = useTheme();
  const shellId = presentationFor(theme).shell;
  const shell = SHELL_PRESENTATIONS[shellId];
  /**
   * ★ 2026-09-30（用户要求）：配置页可关掉「发现」页（默认展示）。
   *   关掉后：导航里不出现「发现」；默认落地页从 `/` 改为 `/home`（源主页）。
   */
  const showDiscover = useShowDiscover();
  const navItems = showDiscover ? NAV : NAV.filter((n) => n.to !== '/');
  const appleGroups = APP_NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((n) => showDiscover || n.to !== '/') }))
    .filter((g) => g.items.length > 0);
  /** 返回/回退的落点：发现被关掉时回「点播」 */
  const backHome = showDiscover ? '/' : '/home';
  useEffect(() => {
    if (!showDiscover && loc.pathname === '/') nav('/home', { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDiscover, loc.pathname]);
  const [appIcon, setAppIcon] = useState('');
  useEffect(() => {
    if (!shell.needsAppIcon) return;
    client.appIcon().then((d) => { if (d) setAppIcon(d); }).catch(() => undefined);
  }, [shell]);
  /** 工具栏标题（= 当前页面名，macOS 统一工具栏的居中标题位） */
  const pageTitle =
    loc.pathname === '/' ? '发现'
      : loc.pathname.startsWith('/home') ? '点播'
        : loc.pathname.startsWith('/search') ? '全源搜索'
          : loc.pathname.startsWith('/detail') ? '影片详情'
            : loc.pathname.startsWith('/history') ? '观看历史'
              : loc.pathname.startsWith('/favorites') ? '我的收藏'
              : loc.pathname.startsWith('/live') ? '直播'
                : loc.pathname.startsWith('/config') ? '配置'
                  : loc.pathname.startsWith('/about') ? '说明'
                    : 'Win-Box';
  /** 工具栏返回箭头（‹）：macOS 窗口的导航回退 */
  const goBack = (): void => {
    if (window.history.length > 1) nav(-1);
    // ★ 2026-10-08：独立详情窗口没有可退的历史 → 返回 = 关窗（更符合「点开一个独立窗口」的直觉）
    else if (isDetailWindow() || isSearchWindow()) void client.winClose();
    else nav(backHome, { replace: true });
  };
  // 首次启动免责声明弹窗：已同意过（localStorage 标记）则不再弹出
  const [disclaim, setDisclaim] = useState(() => {
    try {
      return localStorage.getItem('winbox-disclaim-agreed') !== '1';
    } catch {
      return true;
    }
  });
  // 系统级返回：Alt+← / Backspace（输入控件内不拦截），覆盖所有页面的返回需求
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isNativeModalOpen()) return;
      const t = e.target as HTMLElement | null;
      const typing =
        t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (typing) return;
      const altLeft = e.altKey && e.key === 'ArrowLeft';
      const backspace = e.key === 'Backspace';
      if ((altLeft || backspace) && loc.pathname !== backHome) {
        e.preventDefault();
        goBack(); // ★ 2026-10-08：与工具栏/返回键同一套语义（详情窗口无历史 → 关窗）
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.pathname]);

  // ★ 2026-10-18 插件快捷键（`contributes.keymap`，scope=app）：命中即交给宿主受控动作词表执行
  //   （插件不跑代码；键位在校验期已保证含 Ctrl/Alt/Meta，与宿主裸键不重叠）
  usePluginKeymaps('app', (km) => { void runPluginCommand(km, message => dialog.confirm(message, { title: km.label })); });

  // 初始化加载历史记录
  useEffect(() => {
    loadUiMemory();
    // ★ 2026-10-17（用户要求）：收藏（独立 localStorage 键）——启动即加载，跨启动保留
    loadFavorites();
    // ★ 2026-09-30（用户要求「软件关闭后，所有的墓碑机制都应该脱钩」）：
    //   页面状态类记忆（搜索态/浏览态/详情态）的**脱钩在 renderer/main.tsx 挂载前完成** ——
    //   必须早于首屏渲染，否则 HomePage 会先从 uiMem 恢复出上一次的搜索界面（用户报的现象）。
    //   会话凭据 = 主进程 sessionId（每次启动必变）；观看历史/播放进度照常跨启动保留。
    // ★ 持久化兜底：Electron 关闭窗口/刷新可能不触发 React 卸载 cleanup，
    //   这里监听确定性退出信号立即写盘，保证重启后历史/进度仍在。
    const flush = () => saveUiMemory();
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
      else if (!isPlayerWin) {
        // ★ 播放器窗口写在共享 localStorage 的历史，主窗口在恢复可见时重载，
        //   否则主窗口启动时只 load 一次（当时为空），历史页永远读不到播放器窗口的记录。
        loadUiMemory();
        // ★ 2026-10-17：收藏同款（辅助窗口点收藏/移除后，切回主窗口即同步）
        loadFavorites();
        window.dispatchEvent(new Event(FAVORITES_EVENT));
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('beforeunload', flush);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 页面卸载时保存历史记录
  useEffect(() => {
    return () => {
      saveUiMemory();
    };
  }, []);

  // ★ 播放网盘资源未绑定 cookie → 播放器/内嵌播放窗口发起「去绑定」：
  //   主窗口收到后跳到「点播页」（网盘绑定入口统一在源主页的「网盘绑定」按钮；配置页不再放网盘配置）。
  //   播放器窗口不注册（主进程只把该事件发给主窗口）。
  useEffect(() => {
    if (loc.pathname === '/player') return;
    return client.onNavDriveBind(() => {
      nav('/home');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.pathname]);

  // 独立播放器窗口：#/player 时渲染无侧栏的播放界面（独立 BrowserWindow 使用）
  const isPlayerWin = loc.pathname === '/player';

  // ★ 2026-10-08（用户要求「详情页独立窗口」）：详情窗口复用 —— 主进程在已开的详情窗口上再点片子时
  //   发 `win:navigate`，本窗口切到新路由（不新开窗口、不整页重载，窗口位置/尺寸保留）。
  useEffect(() => {
    if (!isDetailWindow() && !isSearchWindow()) return;
    const off = client.winOnNavigate((route) => nav(route));
    // 首次挂载完成后通知主进程，补发加载期间收到的最新路由。
    const timer = window.setTimeout(() => { void client.winRouteReady().catch(() => undefined); }, 0);
    return () => { window.clearTimeout(timer); off(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ★ 2026-09-20 修复「历史续播位置过期」：独立播放器窗口关闭 → 主窗口重新获得焦点，
  //   此时重载 localStorage 历史（播放器窗口关窗时把最新进度写入了 localStorage），
  //   并广播刷新事件让历史页进度/列表即时同步（此前须切走再切回历史页才刷新）。
  useEffect(() => {
    if (isPlayerWin) return;
    const onFocus = () => {
      loadUiMemory();
      window.dispatchEvent(new Event('winbox:history-refresh'));
      // ★ 2026-10-17：收藏同款 —— 在独立详情/搜索窗口里点的收藏，回到主窗口即能看到
      loadFavorites();
      window.dispatchEvent(new Event(FAVORITES_EVENT));
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [isPlayerWin]);

  /**
   * ★ 2026-10-17（B3「冻结/解冻」）：播放器窗口打开期间，把**本窗口里不可见**的已解码图片释放掉
   *   （只清 `img.src`、原值备份、React 树与数据原地保留，零重载）；播放器关闭即全部挂回。
   *   动因：主窗口图片墙的已解码位图 ≈130~200MB 记在 **GPU 进程**（见 docs/design/内存优化_专项立项.md §2.9）。
   *   玩家窗口自身不接（主进程广播时已排除；这里再兜一道，避免它冻自己的封面）。
   */
  useEffect(() => {
    if (isPlayerWin) return;
    return client.playerOnWindowState((open) => setImageFreezeActive(open));
  }, [isPlayerWin]);

  // 首次同意后主窗口进入说明页；记录标记，下次启动不再弹出或跳转。
  const agreeDisclaim = () => {
    try {
      localStorage.setItem('winbox-disclaim-agreed', '1');
    } catch {
      /* ignore */
    }
    setDisclaim(false);
    if (!isPlayerWin && !isDetailWindow() && !isSearchWindow()) nav('/about', { replace: true });
  };

  const DisclaimerModal = (
    <AppModal
      open={disclaim}
      titleId="disclaimer-title"
      descriptionId="disclaimer-description"
      canClose={false}
      className="app-dialog card modal-in disclaimer-dialog"
      onClose={() => undefined}
    >
      <h2 id="disclaimer-title">Win-Box 使用声明</h2>
      <div className="muted disclaimer-lead" id="disclaimer-description">请在使用前阅读以下内容：</div>
      <div className="disclaimer-copy">
        <p>
          Win-Box 是开源学习项目，提供通用影片播放工具（播放器外壳）。软件不提供内容服务，不存储或推送影视资源与内容。
        </p>
        <p>
          本项目不内置资源索引，也不运营内容服务器。你自行配置或导入的播放源、直播源、弹幕与字幕接口、网盘凭据和内容来自第三方，与本软件及作者无关。软件内的本地代理（127.0.0.1）仅用于在你的设备上转发播放请求。
        </p>
        <p>
          本软件与任何影视平台、内容站点、网盘服务、TVBox / CatVod 及其发行方均无隶属、合作、代理或授权关系。请确保你导入的来源和使用行为符合所在地法律法规，不得用于传播或观看违法、侵权内容；因第三方来源引发的后果由用户与第三方自行承担。
        </p>
        <p>
          本软件不对第三方内容主张权利。权利人如认为本项目的某项行为可能侵权，可通过 GitHub Issues 联系维护者；维护者会核实并配合处理。
        </p>
        <p>
          软件按“现状”提供，不附带任何明示或默示担保。作者不对使用或无法使用本软件造成的直接或间接损失负责。
        </p>
        <p>{MODIFIED_BUILD_DISCLAIMER}</p>
      </div>
      <div className="row disclaimer-actions">
        <button onClick={() => void client.appQuit()}>拒绝</button>
        <button className="primary" onClick={agreeDisclaim}>同意</button>
      </div>
    </AppModal>
  );

  // 详情页"播放"：改为在独立播放器窗口打开（主窗口仍停在选集页）。
  // 传入完整集列表 + 当前集，便于播放器窗口内自换集；主窗口换集经 player:switchEp 同步。
  // ★ 2026-09-30（用户要求）：若在设置里**显式绑定**了第三方播放器 → 直接由它播放，不启动内置播放器窗口；
  //   未绑定 / 解析不出直连地址（需网页解析、需网盘绑定）→ 回退内置播放器窗口（由它上屏原因）。
  const onDetailPlay = (
    _url: string,
    name: string,
    fromKey: string,
    id: string,
    meta?: {
      pic?: string;
      remarks?: string;
      sourceName?: string;
      title?: string;
      vodId?: string;
      episodes?: Episode[];
      epIndex?: number;
      flag?: string;
      profileId?: string;
    },
  ) => {
    const eps = meta?.episodes || [];
    const idx = Math.max(0, Math.min(meta?.epIndex ?? 0, eps.length - 1));
    const target = eps[idx];
    // ★ 剧名副名优先用详情页 detail.name（meta.title）；无则回退从 name 反推首段
    const base = (meta?.title?.trim() || name.split(' - ')[0] || '').trim();
    const openBuiltin = async (): Promise<void> => {
      // 播放器已打开且仍是同一部片时，传递完整集上下文复用窗口；
      // 主进程会校验 key/vodId，不匹配时返回 false，避免把另一部片误切集。
      try {
        const switched = await client.playerSwitchEp({
          key: fromKey,
          vodId: meta?.vodId || id,
          flag: meta?.flag || '',
          episodes: eps,
          epIndex: idx,
          profileId: meta?.profileId,
          sourceName: meta?.sourceName,
        });
        if (switched) return;
      } catch {
        // 播放器尚未打开或 IPC 失败，继续走正常打开流程。
      }
      await client.playerOpen({
        key: fromKey,
        flag: meta?.flag || '',
        episodes: eps,
        epIndex: idx,
        title: base,
        subtitleTitle: base, // ★ 供字幕检索的剧名副名（独立于集名，避免从集名反推失败）
        lastUrl: _url,
        lastName: target ? `${base} - ${target.name}` : name,
        meta: {
          pic: meta?.pic,
          remarks: meta?.remarks,
          sourceName: meta?.sourceName,
          profileId: meta?.profileId,
          vodId: meta?.vodId,
          fromKey,
          id,
        },
      });
    };
    const rawUrl = target?.url || _url;
    void playVodExternal({
      key: fromKey,
      flag: meta?.flag || '',
      rawUrl,
      display: target ? `${base} - ${target.name}` : name,
      pic: meta?.pic,
      remarks: meta?.remarks,
      sourceName: meta?.sourceName,
      profileId: meta?.profileId,
      vodId: meta?.vodId,
      // 同集已有进度 → 外部播放器直接续播（外部播放器无法回传进度，故保留历史里的位置）
      seek: sameEpProgress(fromKey, meta?.vodId, rawUrl, meta?.profileId),
    }).then((out) => {
      if (!out.played) void openBuiltin();
    });
  };

  // ★ 2026-09-24：列表 → 详情的统一跳转（带上封面与片名）
  //   片名兜底：部分源（如「立播」）详情接口不返回 vod_name，详情页用它显示标题/查 TMDb
  // ★ 2026-10-08（用户要求）：外观开关打开时改在**独立窗口**打开（已开则复用换路由）；
  //   本窗口本身就是详情窗口时始终本窗口内跳（相关推荐/演员链不另开窗）。
  const openDetail = (k: string, id: string, pic?: string, name?: string, profileId?: string) => {
    const qs = new URLSearchParams();
    if (pic) qs.set('pic', pic);
    if (name) qs.set('name', name);
    if (profileId) qs.set('profileId', profileId);
    void openDetailRoute((to) => nav(to), k, id, qs.toString());
  };

  if (isPlayerWin) {
    // 独立播放器窗口：仅播放界面（无侧栏）；标题栏由 PlayerPage 内联渲染（标题=当前集）
    return (
      // ★ 2026-10-08：额外挂 `pvwin` 类 —— 豆风皮肤的**独立详情窗口**同样复用 `.app.pwin`，
      //   但它是浅色页面（顶栏 + 内容）；只有真正的播放器窗口需要深色壳（见 douban.css）。
      <div className="app pwin pvwin">
        {disclaim && DisclaimerModal}
        <main className="main">
          <Routes>
            <Route path="/player" element={
              <PageErrorBoundary>
                <Suspense fallback={<RouteLoading />}>
                  <PlayerPage />
                </Suspense>
              </PageErrorBoundary>
            } />
          </Routes>
        </main>
      </div>
    );
  }

  /**
   * 路由表（★ 2026-09-29：抽成数组 —— 三套外壳与辅助窗口**共用同一份**，避免漏改）。
   * ★ 2026-10-15：抽成「路径 + 元素」数组，主界面与辅助窗口两种挂载方式复用同一份路由。
   */
  const routeDefs: Array<{ path: string; el: React.ReactElement }> = [
    // ★ 2026-09-24（用户定稿）：「发现」= 默认首页（软件打开即进这里）；「点播」= 源主页 /home
    { path: '/', el: <DiscoverPage /> },
    { path: '/home', el: <HomePage onOpenDetail={openDetail} /> },
    /**
     * ★ 2026-09-24：全源搜索专用路由 —— 详情页「演员/相关推荐」与发现页卡片点击后跳这里，
     * 由 HomePage 读 `?agg=<关键词>` 自动执行一次全源搜索。
     */
    { path: '/search', el: <HomePage onOpenDetail={openDetail} /> },
    { path: '/history', el: <HistoryPage /> },
    // ★ 2026-10-17（用户要求）：收藏列表（增删改查）
    { path: '/favorites', el: <FavoritesPage /> },
    { path: '/detail/:key/:id', el: <DetailPage onPlay={onDetailPlay} /> },
    { path: '/live', el: <LivePage /> },
    // ★ 2026-09-29：WebDAV 存储（只读）—— 浏览自建 OpenList/AList/Nextcloud 等并播放
    { path: '/storage', el: <StoragePage /> },
    { path: '/config', el: <ConfigPage /> },
    { path: '/about', el: <AboutPage /> },
  ];
  if (import.meta.env.DEV) routeDefs.push({ path: '/_dev/components', el: <ComponentShowcasePage /> });
  const routeChildren = routeDefs.map((d) => <Route key={d.path} path={d.path} element={d.el} />);

  /**
   * ★ 辅助窗口（详情 / 搜索）用的一次性路由：每次切路由重挂 + 过渡动画。
   * ★ 2026-09-24（用户定稿）：布局路由 PageShell 以 pathname 为 key，切页时容器重建并播放一次动画。
   */
  const routesNode = (
    <Routes>
      <Route element={<PageShell />}>{routeChildren}</Route>
    </Routes>
  );

  /**
   * ★ 主界面用的**伪墓碑**路由（见 KeepAliveRoutes）：切页保持挂载、仅隐藏，返回零重载。
   */
  const mainRoutesNode = (
    <PageErrorBoundary>
      <Suspense fallback={<RouteLoading />}>
        <KeepAliveRoutes>{routeChildren}</KeepAliveRoutes>
      </Suspense>
    </PageErrorBoundary>
  );

  /**
   * ★ 2026-10-08（用户要求「详情页独立窗口」）：详情窗口 = **无侧栏的极简外壳**（与 `#/player` 同款），
   *   但路由仍用共享的 routesNode —— 详情页里的「演员 / 相关推荐」会跳 `/search`、其他页面也都可用
   *   （若只放 `/detail` 一条路由，这些跳转会落空白页；页面自身的 topbar 提供各自导航）。
   *   本窗口身份由 hash 的 `dw=1` 决定（见 lib/detailWin.ts）：只写历史/进度、返回=关窗。
   */
  if (isDetailWindow() || isSearchWindow()) {
    return (
      <div className="app pwin">
        {disclaim && DisclaimerModal}
        <main className="main">
          {/* 无边框窗口必须有可拖拽 + 关闭的标题栏（页面自身 topbar 只提供返回/关闭语义） */}
          <TitleBar title={isSearchWindow() ? '搜索结果' : '影片详情'} />
          {routesNode}
        </main>
      </div>
    );
  }

  return (
    <ShellFrame
      presentation={shellId}
      theme={theme}
      navItems={navItems}
      appleGroups={appleGroups}
      appIcon={appIcon}
      pageTitle={pageTitle}
      onBack={goBack}
      backDisabled={loc.pathname === backHome}
      disclaimer={disclaim ? DisclaimerModal : null}
    >
      {mainRoutesNode}
    </ShellFrame>
  );
}

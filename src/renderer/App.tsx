import { NavLink, Outlet, Route, Routes, UNSAFE_LocationContext, useNavigate } from 'react-router-dom';
import TitleBar from './components/TitleBar';
// ★ 2026-10-16（用户要求「四套皮肤绝对大改」）：环境光背景场（四外壳共用的底层氛围层）
import AppAmbient from './components/AppAmbient';
import SearchPanel from './components/SearchPanel';
import PageErrorBoundary from './components/PageErrorBoundary';
import SourcePicker from './components/SourcePicker';
import { memo, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { Location } from 'react-router-dom';
import { cacheGroupOf, cacheKeyOf, cacheLimitOf, isCacheableRoute, PageActiveContext, pickEvictions } from './lib/keepAlive';
import ConfigPage from './pages/ConfigPage';
import HomePage from './pages/HomePage';
import DiscoverPage from './pages/DiscoverPage';
import DetailPage from './pages/DetailPage';
import PlayerPage from './pages/PlayerPage';
import LivePage from './pages/LivePage';
// ★ 2026-09-29：WebDAV 存储（只读浏览/播放）
import StoragePage from './pages/StoragePage';
import HistoryPage from './pages/HistoryPage';
import AboutPage from './pages/AboutPage';
// ★ 2026-10-17（用户要求）：「收藏」页（详情页收藏按钮 + 列表增删改查）
import FavoritesPage from './pages/FavoritesPage';
/** ★ 2026-09-29：启动更新提示（本地版本低于 GitHub 最新 Release 时由用户决定是否更新） */
import UpdateGate from './components/UpdateGate';
import { loadUiMemory, sameEpProgress, saveUiMemory, markHistoryOnlyWriter } from './lib/uiMemory';
// ★ 2026-10-17（用户要求）：二次修改与再分发的免责条款（说明页与首启弹窗共用同一句话）
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
import { client } from './api/client';
import type { Episode } from '../shared/types';

/**
 * ★ 2026-10-08（用户要求「详情页独立窗口」）：详情窗口与主窗口共享同一份 localStorage 的 uiMem，
 *   若整份写盘会把主窗口已清掉的状态复活（与播放器窗口同款问题，见 PlayerPage 顶部那段）。
 *   这里在**模块求值期**声明：本窗口只写历史与进度（任何页面挂载前的第一件事）。
 */
if (isDetailWindow() || isSearchWindow()) markHistoryOnlyWriter();

const NAV = [
  // ★ 2026-09-24（用户定稿）：**发现放第一位，且打开软件默认进发现页**；「点播」= 源主页，移到 /home
  { to: '/', label: '发现', ico: '🧭', end: true },
  { to: '/home', label: '点播', ico: '▶' },
  { to: '/history', label: '历史', ico: '🕘' },
  // ★ 2026-10-17（用户要求）：收藏（详见 pages/FavoritesPage.tsx）
  { to: '/favorites', label: '收藏', ico: '⭐' },
  { to: '/live', label: '直播', ico: '📡' },
  // ★ 2026-09-29（WebDAV 存储）：把自建 OpenList/AList/Nextcloud 等当媒体库浏览播放
  { to: '/storage', label: '存储', ico: '🗄' },
  { to: '/config', label: '配置', ico: '⚙' },
  // 说明页（详细免责声明 + GitHub 主页）
  { to: '/about', label: '说明', ico: 'ℹ' },
];

/**
 * ★ 2026-09-29：Apple 皮肤侧边栏图标 —— SF Symbols 风格**单色线性 SVG**（16px / 1.6 描边）。
 * 不使用 emoji（emoji 会破坏 macOS 侧边栏观感）；其余皮肤仍用 NAV 里的 emoji。
 */
const AP_ICONS: Record<string, React.ReactNode> = {
  // 发现（主页）= house
  '/': (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.6 7.1 8 2.8l5.4 4.3v5.2a.9.9 0 0 1-.9.9H3.5a.9.9 0 0 1-.9-.9V7.1Z" />
    </svg>
  ),
  // 点播（资料库）= play.rectangle
  '/home': (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
      <rect x="1.9" y="3.3" width="12.2" height="9.4" rx="2.3" />
      <path d="M6.7 6.2v3.6l3.2-1.8-3.2-1.8Z" fill="currentColor" stroke="none" />
    </svg>
  ),
  // 历史（继续观看）= clock
  '/history': (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5.1V8l2.1 1.4" />
    </svg>
  ),
  // 直播 = 广播（圆点 + 波纹）
  '/live': (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <circle cx="8" cy="10.6" r="1.5" fill="currentColor" stroke="none" />
      <path d="M5.1 8.1a4.3 4.3 0 0 1 5.8 0M3 5.9a7.1 7.1 0 0 1 10 0" />
    </svg>
  ),
  // 配置 = 齿轮（近似 gearshape）
  '/config': (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <circle cx="8" cy="8" r="2.1" />
      <path d="M8 1.9v1.5M8 12.6v1.5M1.9 8h1.5M12.6 8h1.5M3.7 3.7l1.1 1.1M11.2 11.2l1.1 1.1M12.3 3.7l-1.1 1.1M4.8 11.2l-1.1 1.1" />
    </svg>
  ),
  // 存储（WebDAV）= externaldrive（外置盘）
  '/storage': (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.1" y="3.4" width="11.8" height="9.2" rx="2.2" />
      <path d="M2.1 9.6h11.8" />
      <path d="M5.1 11.8h1.6" />
    </svg>
  ),
  // 说明 = info.circle
  '/about': (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <circle cx="8" cy="8" r="5.6" />
      <path d="M8 7.3v3.4M8 5.2h.01" />
    </svg>
  ),
  // 收藏 = star
  '/favorites': (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 1.9l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.7l-3.8 2 .7-4.3-3.1-3 4.3-.6z" />
    </svg>
  ),
};

/** Apple 皮肤侧边栏的**分组**（HIG：侧边栏最多两级、分组标签要简短） */
const AP_GROUPS: { label: string; items: typeof NAV }[] = [
  { label: '媒体', items: NAV.filter((n) => ['/', '/home', '/history', '/favorites', '/live', '/storage'].includes(n.to)) },
  { label: '其他', items: NAV.filter((n) => ['/config', '/about'].includes(n.to)) },
];

/**
 * 页面外壳（布局路由）：承载「页面切换过渡动画」。
 * ★ 2026-09-24（用户定稿）：以 pathname 为 key → 切页时容器重建并播放一次入场动画（淡入 + 轻微上移，苹果 / Netflix 式）。用布局路由 + Outlet 而非嵌套 Routes，
 *   避免相对路径解析问题；query 变化（如 HomePage 清 `?agg=`）不改 pathname → 不重播动画。
 */
function PageShell() {
  const loc = useLocation();
  return (
    <div className="page-anim" key={loc.pathname}>
      <PageErrorBoundary><Outlet /></PageErrorBoundary>
    </div>
  );
}

/**
 * ★ 2026-10-15（用户要求「伪墓碑：不真关上一个页面、只让它消失」）：
 *   主界面回到**单页内跳转**后，切页**不卸载**上一个页面 —— 保持挂载、仅隐藏（`display:none`），
 *   新页面只替换可见内容，返回时零重载、滚动/分类/搜索态原样保留。刻意不做「真墓碑」
 *   （卸载后序列化/恢复状态）——那套在多窗口下易出错，也是用户反馈「经常出 bug」的根源。
 *
 * 实现要点：
 *   · 每个缓存条目渲染自己那份 `<Routes location={loc}>`，并把该 location 覆盖进
 *     `UNSAFE_LocationContext` —— 于是隐藏页的 `useLocation/useParams/useSearchParams`
 *     仍取到**自己**那份路由（导航仍走全局 NavigationContext，`useNavigate` 不受影响）。
 *   · `KeepEntry` 只在 `(loc, active)` 变化时重渲：**激活的条目每轮把 loc 刷成当前 location**
 *     ⇒ 返回既有实例又拿到当轮路由；隐藏的条目冻结在自己的旧 location 上。
 *   · 卡片按 `routeKey` 缓存：详情一部片一个实例（LRU 4），其余页面各 1 个；直播/存储/配置/说明不缓存。
 */
interface KeepEntryItem { loc: Location; group: string; order: number }

/**
 * react-router 把该字段定义成**字符串枚举**（`Action`，未公开导出）——这里用 Context 反推其字段类型，
 * 避免依赖内部枚举名；断言只此一处（值就是 `'POP'`）。
 */
type LocationContextValue = NonNullable<React.ContextType<typeof UNSAFE_LocationContext>>;
const CTX_NAV_POP = 'POP' as LocationContextValue['navigationType'];

const KeepEntry = memo(function KeepEntry(
  { loc, active, children }: { loc: Location; active: boolean; children: React.ReactNode },
) {
  return (
    <div className="page-anim keep-page" data-active={active ? '1' : '0'}>
      <PageActiveContext.Provider value={active}>
        <UNSAFE_LocationContext.Provider value={{ location: loc, navigationType: CTX_NAV_POP }}>
          <Routes location={loc}>{children}</Routes>
        </UNSAFE_LocationContext.Provider>
      </PageActiveContext.Provider>
    </div>
  );
}, (a, b) => a.loc === b.loc && a.active === b.active);

function KeepAliveRoutes({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const cacheRef = useRef<Map<string, KeepEntryItem>>(new Map());
  const orderRef = useRef(0);
  const pathname = location.pathname;
  const cacheable = isCacheableRoute(pathname);

  if (cacheable) {
    // 本条目按「当轮 location」重渲（激活即刷新自己的路由）；并做同组 LRU 淘汰。
    orderRef.current += 1;
    const key = cacheKeyOf(pathname);
    cacheRef.current.set(key, { loc: location, group: cacheGroupOf(pathname), order: orderRef.current });
    const evict = pickEvictions(
      Array.from(cacheRef.current, ([k, e]) => ({ key: k, group: e.group, order: e.order })),
      key,
      cacheGroupOf(pathname),
      cacheLimitOf(pathname),
    );
    for (const k of evict) cacheRef.current.delete(k);
  }

  return (
    <>
      {Array.from(cacheRef.current, ([key, e]) => (
        <KeepEntry key={key} loc={e.loc} active={cacheable && key === cacheKeyOf(pathname)}>
          {children}
        </KeepEntry>
      ))}
      {/**
        * 非缓存页（直播/存储/配置/说明）：当场渲染、切走即卸载 —— 保持既有语义
        * （配置页要拿刷新态；隐藏的直播会继续出声，故一律不缓存）。
        */}
      {!cacheable && (
        <KeepEntry key="__direct__" loc={location} active>
          {children}
        </KeepEntry>
      )}
    </>
  );
}

export default function App() {
  return (
    <UpdateGate>
      <AppShell />
    </UpdateGate>
  );
}

function AppShell() {
  const nav = useNavigate();
  const loc = useLocation();
  // ★ 2026-10-15：把本窗口的导航函数交给搜索入口 —— 「单页内」模式下搜索在**本窗口内**跳转（伪墓碑）。
  useEffect(() => { bindSearchNav((to) => nav(to)); }, [nav]);
  /** ★ 2026-09-30（用户要求）：皮肤体系 —— 网飝 / 哔哔（都是「顶部导航一体化」外壳）+ 大果 / 豆风（各自独立外壳，见下）。
   *  两个经典主题（经典深/浅）与 sidebar 版式已删除。 */
  const theme = useTheme();
  /**
   * ★ 2026-10-08（用户要求「照参考图做一套外观，允许大改 UI 布局」）：第四套皮肤**豆风**
   *   （Material You × 豆瓣）= 又一个**独立外壳**（见下方 douban 分支）：
   *   顶部白色工具栏（深蓝品牌胶囊 + 页面标题 + 搜索/换源 + 窗口控制）
   *   ＋ 胶囊导航条（选中项橙色实底）
   *   ＋ 右下角浮动圆钮组（发现 / 历史 / 配置）。
   *   页面内部由 douban.css 统一转浅色（淡紫底 + 白卡 + 靛蓝主色 + 琥珀橙点缀）。
   */
  const douban = theme === 'douban';
  /**
   * ★ 2026-09-29（用户要求「完全改布局」）：Apple 皮肤 = **独立外壳**，不复用经典/Netflix 骨架：
   *   全宽 Liquid Glass 工具栏（左置交通灯 + 返回箭头 + 页面标题 + 右侧搜索/换源）
   *   ＋ 玻璃侧边栏（分组：媒体 / 其他，SF 风格线性图标，选中项实心蓝）
   *   ＋ 内容区（Apple TV 式精选轮播 + 内容栏，见 DiscoverPage / apple.css）。
   */
  const apple = theme === 'apple';
  /**
   * ★ 2026-10-16（用户要求「四套皮肤各有特色、绝对大改」）：**哔哔专属外壳**。
   *   此前「哔哔与 netflix 共用 `.nf-nav` 单行顶栏」正是四套皮肤长得像的根源之一。
   *   现在哔哔独立为**双行头**：上行为「品牌 + 居中搜索 + 换源 + 窗口控制」，
   *   下行为**分类 tab 条**（选中项蓝色胶囊 + 弹跳）——
   *   与 netflix 的「满幅渐变浮层」、大果的「侧边栏」、大豆的「胶囊导航条」形态互不相同。
   */
  const bilibili = theme === 'bilibili';
  /**
   * ★ 2026-09-30（用户要求）：配置页可关掉「发现」页（默认展示）。
   *   关掉后：导航里不出现「发现」；默认落地页从 `/` 改为 `/home`（源主页）。
   */
  const showDiscover = useShowDiscover();
  const navItems = showDiscover ? NAV : NAV.filter((n) => n.to !== '/');
  const apGroups = AP_GROUPS
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
    // 大果（侧边栏品牌）+ 大豆（顶栏品牌块）都用应用图标
    if (!apple && !douban) return;
    client.appIcon().then((d) => { if (d) setAppIcon(d); }).catch(() => undefined);
  }, [apple, douban]);
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
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
      else if (!isPlayerWin) {
        // ★ 播放器窗口写在共享 localStorage 的历史，主窗口在恢复可见时重载，
        //   否则主窗口启动时只 load 一次（当时为空），历史页永远读不到播放器窗口的记录。
        loadUiMemory();
        // ★ 2026-10-17：收藏同款（辅助窗口点收藏/移除后，切回主窗口即同步）
        loadFavorites();
        window.dispatchEvent(new Event(FAVORITES_EVENT));
      }
    });
    return () => {
      window.removeEventListener('beforeunload', flush);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flush);
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
    <div
      className="modal-scrim"
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(4px)',
      }}
    >
      <div
        className="card modal-in"
        style={{
          width: 520, maxWidth: '92vw', maxHeight: '80vh', overflow: 'auto', padding: 22,
          background: 'var(--bg)', boxShadow: '0 18px 60px rgba(0,0,0,.5)',
        }}
      >
        <h3 style={{ margin: '0 0 6px' }}>Win-Box 使用声明</h3>
        <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>请在使用前阅读以下内容：</div>
        <div style={{ fontSize: 13, lineHeight: 1.8 }}>
          <p style={{ margin: '0 0 8px' }}>
            Win-Box 是一个<b>开源（Open Source）学习项目</b>，本质上仅为一个通用的影片播放工具。
          </p>
          <p style={{ margin: '0 0 8px' }}>
            本项目<b>不含任何盈利行为</b>，不提供服务、不存储、不推送任何影视资源与内容，主要用途是个人学习研究，尤其是「Vibe Coding」编程体验。
          </p>
          <p style={{ margin: '0 0 8px' }}>
            你在使用过程中自行配置/导入的播放源与资源均来自<b>第三方</b>，与本软件及作者无关。
            因使用第三方来源所引发的一切后果（含版权、侵权、内容合法性）由用户与第三方自行承担，作者免责。
          </p>
          {/* ★ 2026-10-17（用户要求）：与说明页「八、二次修改与再分发」同一句话（见 lib/disclaimerText） */}
          <p style={{ margin: 0 }}>{MODIFIED_BUILD_DISCLAIMER}</p>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
          {/* ★ 2026-10-14：`flex: 0` = `0 1 0%` ⇒ flex-basis 归零后按 min-content 收缩，
              中文按钮会被压成「1 个字宽」并把文字折成两行（看起来像竖排按钮）。
              与本仓其它按钮统一用 `0 0 auto`（不可收缩、按内容取宽）。 */}
          <button style={{ flex: '0 0 auto' }} onClick={() => void client.appQuit()}>拒绝</button>
          <button className="primary" style={{ flex: '0 0 auto' }} onClick={agreeDisclaim}>同意</button>
        </div>
      </div>
    </div>
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
  const openDetail = (k: string, id: string, pic?: string, name?: string) => {
    const qs = new URLSearchParams();
    if (pic) qs.set('pic', pic);
    if (name) qs.set('name', name);
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
            <Route path="/player" element={<PlayerPage />} />
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
  const mainRoutesNode = <KeepAliveRoutes>{routeChildren}</KeepAliveRoutes>;

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

  /**
   * ★ 2026-09-29：Apple（macOS / Liquid Glass）专属外壳 —— 窗口结构按 macOS 原生应用重排：
   *   ① 顶部**全宽统一工具栏**（交通灯左置 → 返回箭头 → 页面标题 → 右侧搜索 + 换源），
   *      整条可拖拽窗口（-webkit-app-region: drag，交互元素 no-drag）；
   *   ② 下方为「玻璃侧边栏 + 内容区」双栏（侧边栏分组 + 侧边栏底部当前源）。
   */
  if (apple) {
    return (
      <div className="app ap-app">
        <AppAmbient />
        {disclaim && DisclaimerModal}
        <header className="ap-toolbar">
          <TitleBar variant="mac" />
          <button className="ap-navbtn" title="返回" aria-label="返回" disabled={loc.pathname === '/'} onClick={goBack}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9.8 3.4 5.2 8l4.6 4.6" />
            </svg>
          </button>
          <span className="ap-toolbar-title">{pageTitle}</span>
          <span className="ap-spacer" />
          <SearchPanel />
          <SourcePicker />
        </header>
        <div className="ap-body">
          <aside className="ap-sidebar">
            <div className="ap-brand" title="Win-Box">
              {appIcon ? <img className="ap-brand-ico" src={appIcon} alt="" draggable={false} /> : <span className="ap-brand-dot" />}
              <span className="ap-brand-name">Win-Box</span>
            </div>
            {apGroups.map((g) => (
              <div key={g.label} className="ap-group">
                <div className="ap-group-label">{g.label}</div>
                {g.items.map((n) => (
                  <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => 'ap-nav' + (isActive ? ' active' : '')}>
                    <span className="ap-nav-ico">{AP_ICONS[n.to]}</span>
                    <span className="ap-nav-txt">{n.label}</span>
                  </NavLink>
                ))}
              </div>
            ))}
            <div className="ap-side-spacer" />
            <SourcePicker variant="sidebar" />
          </aside>
          <main className="ap-main">{mainRoutesNode}</main>
        </div>
      </div>
    );
  }

  /**
   * ★ 2026-10-16：**哔哔专属外壳**（双行头：搜索行 + 分类 tab 条；样式全部在 bilibili.css）。
   *   与其余三套外壳的分工：netflix = 满幅渐变浮层压在 billboard 上；大果 = 侧边栏 + 工具栏；
   *   大豆 = 顶栏 + 胶囊导航条 + 右下浮动钮。四者形态互不相同 —— 这是「大改」的骨架层落点。
   */
  if (bilibili) {
    return (
      <div className="app bb-app">
        <AppAmbient />
        {disclaim && DisclaimerModal}
        <header className="bb-head">
          <div className="bb-top">
            <span className="bb-brand" title="Win-Box">
              <span className="bb-brand-mark" aria-hidden="true">b</span>
              WIN-BOX
            </span>
            {/* M3 式搜索条变体复用：这里做成「居中宽胶囊」 */}
            <SearchPanel bar />
            <span className="bb-spacer" />
            <SourcePicker />
            <TitleBar />
          </div>
          <nav className="bb-tabs">
            {navItems.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => 'bb-tab' + (isActive ? ' active' : '')}>
                {n.label}
              </NavLink>
            ))}
          </nav>
        </header>
        <main className="bb-main">{mainRoutesNode}</main>
      </div>
    );
  }

  /**
   * ★ 2026-10-08（用户要求「照参考图做一套外观，允许大改 UI 布局」）：**豆风独立外壳**
   *   （Material You × 豆瓣；样式全部在 douban.css）：
   *   ① `.db-head` = 顶栏（深蓝品牌胶囊「WIN-BOX」+ 页面标题 + 搜索/换源 + 窗口控制）＋ 胶囊导航条；
   *   ② `.db-main` = 路由内容（页面自身 topbar / 网格 / 卡片照常，配色由皮肤转浅）；
   */
  if (douban) {
    return (
      <div className="app db-app">
        <AppAmbient />
        {disclaim && DisclaimerModal}
        <header className="db-head">
          <div className="db-topbar">
            <span className="db-brand" title="Win-Box">
              {appIcon ? <img className="db-brand-ico" src={appIcon} alt="" draggable={false} /> : <span className="db-brand-dot" />}
              WIN-BOX
            </span>
            <span className="db-title">{pageTitle}</span>
            {/* ★ 2026-10-08：M3 搜索条 —— 直接占顶栏中段（原来只有右上角一个小胶囊） */}
            <SearchPanel bar />
            <span className="db-spacer" />
            <SourcePicker />
            <TitleBar />
          </div>
          <nav className="db-nav">
            {navItems.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => 'db-chip' + (isActive ? ' active' : '')}>
                {n.label}
              </NavLink>
            ))}
          </nav>
        </header>
        <main className="db-main">{mainRoutesNode}</main>
      </div>
    );
  }

  return (
    <div className={`app nf ${theme}`.trim()}>
      <AppAmbient />
      {disclaim && DisclaimerModal}
      <main className="main">
        {/* ★ 2026-09-24：**一体化顶栏** —— 网飝 / 哔哔把标题栏（窗口控制）并进导航条同一行，
            不再单独占一行（此前隐藏标题文字后 space-between 把按钮挤到左上，且看起来像两行） */}
        <nav className="nf-nav">
          <span className="nf-logo">WIN-BOX</span>
          {navItems.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => 'nf-link' + (isActive ? ' active' : '')}>
              {n.label}
            </NavLink>
          ))}
          <span className="nf-spacer" />
          {/* ★ 2026-09-24：右上角搜索按钮（面板含热搜 + 自动联想）与「源名纯文字」换源入口 */}
          <SearchPanel />
          <SourcePicker />
          <TitleBar />
        </nav>
        {mainRoutesNode}
      </main>
    </div>
  );
}

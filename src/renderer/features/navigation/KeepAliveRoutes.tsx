import type React from 'react';
import { memo, useState } from 'react';
import { Routes, UNSAFE_LocationContext, useLocation, type Location } from 'react-router-dom';
import { cacheGroupOf, cacheKeyOf, cacheLimitOf, isCacheableRoute, PageActiveContext, pickEvictions } from '../../lib/keepAlive';

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

export function KeepAliveRoutes({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [cache, setCache] = useState<{ location: Location; entries: Map<string, KeepEntryItem>; order: number }>(() => ({ location, entries: new Map(), order: 0 }));
  const pathname = location.pathname;
  const cacheable = isCacheableRoute(pathname);
  let entries = cache.entries;
  if (cache.location !== location || (cacheable && !entries.has(cacheKeyOf(pathname)))) {
    entries = new Map(entries);
    const order = cache.order + 1;
    if (cacheable) {
      const key = cacheKeyOf(pathname);
      const group = cacheGroupOf(pathname);
      entries.set(key, { loc: location, group, order });
      const evict = pickEvictions(Array.from(entries, ([key, entry]) => ({ key, group: entry.group, order: entry.order })), key, group, cacheLimitOf(pathname));
      for (const key of evict) entries.delete(key);
    }
    setCache({ location, entries, order });
  }

  return (
    <>
      {Array.from(entries, ([key, e]) => (
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


// src/renderer/components/DiscoverSpotlight.tsx
// ★ 2026-10-16（用户要求「四套皮肤绝对大改」）：发现页首屏**聚光卡**（四皮肤共用结构，材质由各皮肤 CSS 决定）。
// ★ 2026-10-16 修正（用户报「Hero 做了但加载不出封面」→ 先试 360 图搜 → 又报「配图是错的」）：
//   最终口径 = **横版图只走 TMDB 系**（榜单自带 backdrop，或按 tmdbId 调纯 TMDB images），
//   **彻底弃用 360 图搜**（它对短名片名会配错图，实测「希望」→ 写着「好运来」的图，属机制性缺陷）。
//   取不到横版图时退回「竖版海报模糊成色场」兜底（不做生硬裁切，也不会看着像没加载出来）。
//   hero 只在**真拿到横版图**的那些片子里轮播（见下方 usable 逻辑）。
import { useEffect, useMemo, useRef, useState } from 'react';
import { client } from '../api/client';
import type { DiscoverItem } from '../../shared/types';

const keyOf = (it: DiscoverItem): string => `${it.title}|${it.year || ''}`;

export default function DiscoverSpotlight({
  items,
  picOf,
  onOpen,
  landscape = false,
}: {
  items: DiscoverItem[];
  picOf: (it: DiscoverItem) => string;
  onOpen: (title: string) => void;
  /** true = 用横版剧照当满幅景（netflix 的 billboard）；false = 只用竖版海报做柔化底（其余三套的卡片式聚光） */
  landscape?: boolean;
}) {
  const [idx, setIdx] = useState(0);
  const itemsKey = items.map((i) => keyOf(i)).join('|');

  /** 横版剧照缓存：key → URL（**只在真的拿到图时才写入**；拿不到交给重试循环） */
  const [bgs, setBgs] = useState<Record<string, string>>({});
  const bgsRef = useRef(bgs);
  bgsRef.current = bgs;
  /** 同一片名的在飞请求（去重） */
  const inflight = useRef<Set<string>>(new Set());
  /** 每片尝试次数上限（命中主进程缓存后重试几乎零成本；真无图也不无限打） */
  const tries = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!landscape || items.length === 0) return;
    let stopped = false;
    const take = (k: string, url: string): void => {
      bgsRef.current = { ...bgsRef.current, [k]: url };
      setBgs((prev) => (prev[k] === url ? prev : { ...prev, [k]: url }));
    };
    const fetchOne = (it?: DiscoverItem): void => {
      if (!it) return;
      const k = keyOf(it);
      if (bgsRef.current[k]) return;              // 已有横版图
      /**
       * ★★ 2026-10-16（用户口径「海报横图还是走 TMDB / 抓豆瓣的横板剧照」）：
       *   取图顺序 = ① 榜单自带 backdrop（TMDB backdrop_path）→ ② `metaDiscoverImages`
       *   （主进程内部：**优先豆瓣剧照**（按 doubanId 精确取，图源与条目一一对应，不会错配）→
       *     其次用户自带的 TMDB 凭据）→ ③ 都没有就**不出图**，退竖版海报模糊色场。
       *   ★ 并**拒绝 360 图搜的来源**（其 URL 走 `/file/discovery-images/`）：实测它对短名片名会配错图
       *     （「希望」→ 写着「好运来」的图），属机制性缺陷 —— 宁可不轮播，也不给错图。
       */
      if (it.backdrop) { take(k, it.backdrop); return; }
      if (!it.doubanId && !it.tmdbId) return;   // 豆瓣剧照与 TMDB 都无从取 → 不出图
      if (inflight.current.has(k)) return;
      if ((tries.current.get(k) || 0) >= 2) return;
      tries.current.set(k, (tries.current.get(k) || 0) + 1);
      inflight.current.add(k);
      client
        .metaDiscoverImages(it.title, it.mediaType, it.year ? String(it.year) : undefined, 'backdrop', it.doubanId)
        .then((r) => {
          const url = (r?.backdrops || []).find((u) => !/\/file\/discovery-images\//.test(u)) || '';
          if (url) take(k, url);
        })
        .catch(() => { /* 留给重试循环 */ })
        .finally(() => inflight.current.delete(k));
    };
    items.forEach(fetchOne);
    // TMDB 偶发失败 / 榜单后到时补一两次（命中后是本地缓存，成本极低）
    const timer = setInterval(() => { if (!stopped) items.forEach(fetchOne); }, 6000);
    return () => { stopped = true; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landscape, itemsKey]);

  /** ★ 只在「有横版图」的片子里轮播；一张都没有才整体退回兜底列表 */
  const usable = useMemo(
    () => (landscape ? items.filter((it) => bgs[keyOf(it)]) : items),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [landscape, itemsKey, bgs],
  );
  const list = usable.length ? usable : items;

  useEffect(() => { setIdx(0); }, [itemsKey]);
  useEffect(() => {
    if (list.length <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % list.length), 7000);
    return () => clearInterval(t);
  }, [itemsKey, list.length]);

  if (!list.length) return null;
  const pos = idx % list.length;
  const cur = list[pos];
  const curBg = landscape ? bgs[keyOf(cur)] : '';
  const curArt = curBg || picOf(cur);

  const artOf = (it: DiscoverItem): string => (landscape ? bgs[keyOf(it)] || picOf(it) : picOf(it));

  return (
    <section className="spot" aria-label="本周精选">
      {/* 景：netflix = 横版剧照（锐利）；兜底/其余皮肤 = 竖版海报（模糊成色场，不做生硬裁切） */}
      <div className="spot-art" aria-hidden="true">
        {list.slice(0, 6).map((it, i) => {
          const bg = landscape ? bgs[keyOf(it)] : '';
          const src = artOf(it);
          if (!src) return null;
          return (
            <div
              key={`${it.title}-${i}`}
              className={'spot-art-layer' + (bg ? '' : ' spot-art-blur')}
              style={{ backgroundImage: `url("${src}")`, opacity: i === pos ? 1 : 0 }}
            />
          );
        })}
      </div>
      <div className="spot-veil" aria-hidden="true" />

      <div className="spot-body">
        <span className="spot-kicker">
          <span className="spot-kicker-dot" aria-hidden="true" />
          本周精选
        </span>
        <h2 className="spot-title" title={cur.title}>{cur.title}</h2>
        <div className="spot-meta">
          {cur.year ? <span className="spot-year">{cur.year}</span> : null}
          <span className="spot-sep" aria-hidden="true">·</span>
          <span>{cur.mediaType === 'tv' ? '剧集' : '电影'}</span>
          <span className="spot-rank">No.{pos + 1}</span>
        </div>
        <div className="spot-acts">
          <button type="button" className="primary spot-go" onClick={() => onOpen(cur.title)}>
            <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M5.2 3.2v9.6l7.4-4.8-7.4-4.8Z" fill="currentColor" /></svg>
            立即搜索
          </button>
          {list.length > 1 && (
            <button type="button" className="spot-next" onClick={() => setIdx((i) => (i + 1) % list.length)}>
              换一部
            </button>
          )}
        </div>
      </div>

      {/* 海报卡：billboard 皮肤（netflix）下由 CSS 隐藏；卡片式皮肤的右侧主体 */}
      <div className="spot-stage" aria-hidden="true">
        <div className="spot-poster" style={curArt ? { backgroundImage: `url("${curArt}")` } : undefined}>
          {!curArt && <span className="spot-poster-none">暂无封面</span>}
        </div>
        {list.length > 1 && (
          <div
            className="spot-poster spot-poster-ghost"
            style={(() => {
              const p = artOf(list[(pos + 1) % list.length]);
              return p ? { backgroundImage: `url("${p}")` } : undefined;
            })()}
          />
        )}
      </div>

      {list.length > 1 && (
        <div className="spot-dots">
          {list.slice(0, 6).map((it, i) => (
            <button
              key={`${it.title}-dot-${i}`}
              type="button"
              className={'spot-dot' + (i === pos ? ' active' : '')}
              aria-label={`第 ${i + 1} 部`}
              onClick={() => setIdx(i)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

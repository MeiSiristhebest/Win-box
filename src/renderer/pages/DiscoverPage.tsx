// src/renderer/pages/DiscoverPage.tsx — 发现页（★ 2026-09-24 起为**默认首页**，侧边栏第一个）
// 内容：
//   ① 推荐（豆瓣榜单 + 国内热搜；主进程持久缓存，过期后台更新）
//   ② 级联分类（★ 2026-10-15 用户要求，数据层走**豆瓣**）：分类 → 类型 → 地区 → 年代 → 排序，
//      **逐级点击才展开下级**；选项表直接用豆瓣自带的类型/地区词表（两页共用，永远一致，且不会空结果）。
// 交互：点任意影片 → 走 `#/search?agg=<片名>` 用「源」做一次全源搜索（没源时提示去导入）。
import { useEffect, useMemo, useRef, useState } from 'react';
import { client } from '../api/client';
import { openSearchWindow } from '../lib/searchWin';
import { useTheme } from '../lib/theme';
import HScrollRow from '../components/HScrollRow';
import CascadeBar, { type CascadeLevel, type CascadeOption } from '../components/CascadeBar';
import { useCovers } from '../lib/useCovers';
import { ALL_TAG, DISCOVER_MEDIA, type DiscoverMediaId, type ExploreVocabulary } from '../../shared/discover';
import type { DiscoverItem, DiscoverSection } from '../../shared/types';

/** 每页条数（豆瓣 recommend 的 count） */
const PAGE_SIZE = 20;
/** 豆瓣 total 上限（接口自身封顶 500） */
const MAX_TOTAL = 500;

/** 影片卡（推荐区与分类区共用）：点击 → 全源搜索该片名。
   *  playBadge ★ 2026-09-29：仅 Apple 皮肤渲染的「悬停播放徽标」—— 只在 Apple 下渲染元素，
   *  其余皮肤零痕迹（不依赖别处补 `display:none`）。
   *  dbPlay/dbYear ★ 2026-10-08（豆风）：海报墙卡 —— 悬停浮出圆形播放钮 + 左下角年份角标（豆瓣海报墙观感）。 */
function ItemCard({ it, poster, onError, onOpen, playBadge, dbPlay, dbYear }: { it: DiscoverItem; poster: string; onError: (url: string) => void; onOpen: () => void; playBadge?: boolean; dbPlay?: boolean; dbYear?: boolean }) {
  return (
    <div
      className="card-media"
      style={{ cursor: 'pointer' }}
      role="button"
      tabIndex={0}
      aria-label={`${it.title}${it.year ? ` (${it.year})` : ''}，点击全源搜索`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      title={`${it.title}${it.year ? ` (${it.year})` : ''} · 点击全源搜索`}
    >
      <div className="card">
        <div style={{ position: 'relative' }}>
          {poster ? <img src={poster} loading="lazy" decoding="async" onError={e => onError(e.currentTarget.getAttribute('src') || '')} /> : <div className="no-cover">暂无封面</div>}
          {playBadge && (
            <span className="ap-card-play" aria-hidden="true">
              <svg width="13" height="13" viewBox="0 0 16 16"><path d="M4.9 2.9v10.2l8-5.1-8-5.1Z" fill="currentColor" /></svg>
            </span>
          )}
          {dbPlay && (
            <span className="db-card-play" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 16 16"><path d="M5.1 3.1v9.8l7.6-4.9-7.6-4.9Z" fill="currentColor" /></svg>
            </span>
          )}
          {dbYear && it.year ? <span className="badge db-year-badge">{it.year}</span> : null}
        </div>
        <div className="meta">
          <div className="name" title={it.title}>{it.title}</div>
          {it.year && !dbYear ? <div className="remarks">{it.year}</div> : null}
        </div>
      </div>
    </div>
  );
}

export default function DiscoverPage() {
  // 发现页直接展示分类与榜单；Netflix / Apple 保留横向内容行，豆风使用海报网格。
  const theme = useTheme();
  const nf = theme === 'netflix';
  const ap = theme === 'apple';
  const db = theme === 'douban';
  const [sections, setSections] = useState<DiscoverSection[] | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  /** ★ 2026-10-08（豆风）：海报墙当前分区（顶部 pill 切换 —— 替代「一行行横滑」的堆叠布局） */
  const [wallSec, setWallSec] = useState(0);

  // ---- 级联分类（★ 2026-10-15；选项表来自豆瓣自带的类型/地区词表）----
  const [vocab, setVocab] = useState<ExploreVocabulary | null>(null);
  /** 一级「分类」：null = 未选（此时展示榜单） */
  const [media, setMedia] = useState<DiscoverMediaId | null>(null);
  /** 各维度已选值（维度名 → 选项文本；`全部` = 不参与筛选）；缺失 = 该级未选、不展开下级 */
  const [dims, setDims] = useState<Record<string, string>>({});
  const [sortId, setSortId] = useState('');
  const [items, setItems] = useState<DiscoverItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [bLoading, setBLoading] = useState(false);
  const [bErr, setBErr] = useState('');
  const reqRef = useRef(0);

  const mediaOpt = DISCOVER_MEDIA.find(m => m.id === media) || null;
  const mediaType: 'movie' | 'tv' = mediaOpt?.mediaType || 'movie';
  const coverItem = (it: DiscoverItem) => ({ id: String(it.doubanId || it.tmdbId || it.title), name: it.title, year: it.year ? String(it.year) : undefined, pic: it.poster });
  /** 预热封面：分类浏览有结果时用它，否则用（默认 / 回退）榜单 */
  const coverSource = media !== null && items.length > 0
    ? items
    : (db ? sections?.[wallSec]?.items || [] : sections?.flatMap(s => s.items) || []);
  const covers = useCovers(coverSource.map(coverItem));

  const goSearch = (title: string): void => { void openSearchWindow(title).catch((e) => window.alert(String(e))); };

  /**
   * 拉榜单（走主进程 6h 缓存）。
   * ★ 2026-09-25（用户报「发现页经常加载不出来」）：跨境/偶发超时会让整页空 → 渲染层补两道：
   *   ① 首次结果为空 → 1.2s 后自动重试一次；② 仍为空 → 错误提示里给「重试」按钮。
   */
  const load = (): void => {
    setLoading(true);
    setErr('');
    client
      .metaDiscover(false)
      .then((s) => {
        if (s.length) setSections(s);
        else setSections(previous => previous?.length ? previous : s);
        if (s.length === 0) setErr('榜单暂时获取失败，请稍后重试；如已配置 TMDB，请检查自己的凭据和网络');
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  };
  /** 已自动重试过（避免「空 → 重试 → 空」无限循环） */
  const autoRetriedRef = useRef(false);
  useEffect(() => {
    if (loading || sections === null || sections.length > 0 || autoRetriedRef.current) return;
    autoRetriedRef.current = true;
    const t = setTimeout(() => load(), 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, sections]);
  useEffect(() => {
    load();
    client.metaExploreVocab()
      .then((v) => { setVocab(v); setSortId(prev => prev || v.movie.defaultSort); })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 当前分类可用的维度（综艺没有「类型」——它本身就是类型） */
  const dimensions = useMemo(() => {
    if (!vocab || !media) return [];
    if (media === 'movie') return vocab.movie.dimensions;
    if (media === 'tv') return vocab.tv.dimensions;
    return vocab.tv.dimensions.filter(d => d.key !== '类型');
  }, [vocab, media]);
  const sorts = media === 'tv' || media === 'variety' ? vocab?.tv.sorts : vocab?.movie.sorts;

  /** 当前选择对应的豆瓣 tags（跳过「全部」） */
  const tagsOf = (sel: Record<string, string>): string[] =>
    [mediaOpt?.baseTag || '', ...Object.values(sel).filter(v => v && v !== ALL_TAG)].filter(Boolean);

  const fetchPage = (pg: number, sel = dims): void => {
    if (!media || !mediaOpt) return;
    const id = ++reqRef.current;
    setBLoading(true);
    setBErr('');
    client
      .metaDiscoverQuery({
        mediaType,
        tags: tagsOf(sel),
        ...(sortId ? { sort: sortId } : {}),
        start: (pg - 1) * PAGE_SIZE,
        count: PAGE_SIZE,
      })
      .then((r) => {
        if (id !== reqRef.current) return;
        setItems(r.items);
        setTotal(r.total);
        setPage(pg);
        if (r.items.length === 0) setBErr('该组合暂无结果，可放宽「类型 / 地区 / 年代」，或换一种「排序」再试');
      })
      .catch(() => { if (id === reqRef.current) { setItems([]); setBErr('豆瓣分类请求失败，请稍后重试'); } })
      .finally(() => { if (id === reqRef.current) setBLoading(false); });
  };

  /** 筛选变化 → 从第 1 页重取（★ 逐级点击才走到这里：每级选定都会即时出结果） */
  useEffect(() => {
    if (!media) {
      ++reqRef.current;
      setItems([]); setPage(1); setTotal(0); setBErr(''); setBLoading(false);
      return;
    }
    fetchPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media, dims, sortId]);

  /** 级联点选：同级再点 = 取消（同时清掉其下各维度，保证「上级一变，下级重来」） */
  const onPick = (levelKey: string, id: string): void => {
    if (levelKey === 'media') {
      setMedia(media === id ? null : id as DiscoverMediaId);
      setDims({});
      return;
    }
    if (levelKey === 'sort') { setSortId(id); return; }
    const order: string[] = dimensions.map(d => d.key);
    const idx = order.indexOf(levelKey);
    const next: Record<string, string> = {};
    for (let i = 0; i < idx; i++) {
      const k = order[i];
      if (dims[k] !== undefined) next[k] = dims[k];
    }
    if (dims[levelKey] !== id) next[levelKey] = id;
    setDims(next);
  };

  const backToRecommend = (): void => {
    setMedia(null); setDims({});
    void load();
  };

  /** 级联各级：**只把该出现的级放进来**（上一级选定后才出现），即「点击后才展开下级分类」 */
  const levels: CascadeLevel[] = [{ key: 'media', label: '分类', value: media, options: DISCOVER_MEDIA.map(m => ({ id: m.id, label: m.name })) }];
  {
    let prevChosen = media !== null;
    for (const d of dimensions) {
      if (!prevChosen) break;
      const v = dims[d.key];
      levels.push({
        key: d.key,
        label: d.label,
        value: v === undefined ? null : v,
        options: d.values.filter(x => x !== ALL_TAG).map(x => ({ id: x, label: x })) as CascadeOption[],
        allLabel: ALL_TAG,
      });
      prevChosen = v !== undefined;
    }
    if (prevChosen && sorts && sorts.length) {
      levels.push({ key: 'sort', label: '排序', value: sortId, options: sorts.map(s => ({ id: s.id, label: s.label })) });
    }
  }

  /** 当前选择的摘要（「电影 · 喜剧 · 中国大陆 · 2024 · 综合排序」），不写废话 */
  const summary = ((): string => {
    if (!mediaOpt) return '';
    const parts = [mediaOpt.name];
    for (const d of dimensions) {
      const v = dims[d.key];
      if (v !== undefined) parts.push(v === ALL_TAG ? `全部${d.label}` : v);
    }
    const s = sorts?.find(x => x.id === sortId);
    if (s) parts.push(s.label);
    return parts.join(' · ');
  })();

  const totalPages = Math.max(1, Math.ceil(Math.min(total, MAX_TOTAL) / PAGE_SIZE));

  /** 推荐榜单（默认视图 / 分类不可用时的回退视图共用） */
  const sectionsView = (): React.ReactNode =>
    db ? (
      <div className="db-wall">
        <div className="db-wall-chips" key={`chips-${sections?.length || 0}`}>
          {(sections || []).map((s, i) => (
            <button key={s.id} type="button" className={'db-wall-chip' + (i === wallSec ? ' active' : '')} onClick={() => setWallSec(i)}>
              {s.title}
            </button>
          ))}
        </div>
        <div className="grid db-wall-grid" key={`wall-${wallSec}`}>
          {((sections || [])[Math.min(wallSec, Math.max(0, (sections || []).length - 1))]?.items || []).map((it, i) => (
            <ItemCard key={`${it.title}-${i}`} it={it} poster={covers.picOf(coverItem(it))} onError={url => covers.onError(coverItem(it), url)} onOpen={() => goSearch(it.title)} dbPlay dbYear />
          ))}
        </div>
      </div>
    ) : (
      (sections || []).map((s) => (
        <div key={s.id} className={nf ? 'nf-row' : ap ? 'ap-row' : undefined} style={nf || ap ? undefined : { marginBottom: 22 }}>
          <h3 className={nf ? 'nf-row-title' : ap ? 'ap-row-title' : undefined} style={nf || ap ? undefined : { margin: '0 0 10px' }}>{s.title}</h3>
          {/* 横向滚动条：滚轮在行内 → 横向滚动（见 HScrollRow）；行外空白 → 页面上下滚动 */}
          <HScrollRow
            className={nf ? 'nf-row-scroll' : ap ? 'ap-row-scroll' : undefined}
            style={nf || ap ? undefined : { display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 6 }}
          >
            {s.items.map((it, i) => (
              <div key={`${it.title}-${i}`} style={nf ? undefined : { flex: ap ? '0 0 168px' : '0 0 132px', minWidth: 0 }}>
                <ItemCard
                  it={it}
                  poster={covers.picOf(coverItem(it))}
                  onError={url => covers.onError(coverItem(it), url)}
                  playBadge={ap}
                  onOpen={() => goSearch(it.title)}
                />
              </div>
            ))}
          </HScrollRow>
        </div>
      ))
    );

  return (
    <>
      <div className="content">
        {/* ---- 级联分类条：分类 → 类型 → 地区 → 年代 → 排序（逐级点击才展开下级）---- */}
        <CascadeBar levels={levels} onPick={onPick} />
        {media === null || !mediaOpt ? (
          loading && !sections ? (
            <div className="empty"><span className="spinner" aria-hidden="true" />加载中…</div>
          ) : err && (!sections || sections.length === 0) ? (
            <div className="err">
              {err}
              <button
                style={{ marginLeft: 10 }}
                onClick={() => {
                  autoRetriedRef.current = true;
                  load();
                }}
              >
                重试
              </button>
            </div>
          ) : (
            sectionsView()
          )
        ) : (
          <>
            <div className="row" style={{ marginBottom: 10 }}>
              <h3 style={{ margin: 0 }}>{summary}</h3>
              <div style={{ flex: 1 }} />
              <button style={{ flex: '0 0 auto' }} onClick={backToRecommend}>返回推荐</button>
            </div>
            {bLoading && items.length === 0 ? (
              <div className="empty"><span className="spinner" aria-hidden="true" />加载中…</div>
            ) : items.length === 0 ? (
              // 豆瓣取不到（失败/风控）或该组合确实无结果 → 可读提示 + 回退榜单
              <>
                <div className="empty">
                  {bErr || '该组合暂无结果'}
                  <button style={{ marginLeft: 10 }} onClick={() => fetchPage(1)}>重试</button>
                </div>
                {sectionsView()}
              </>
            ) : (
              <>
                <div className="grid">
                  {items.map((it, i) => (
                    <ItemCard key={`${it.title}-${i}`} it={it} poster={covers.picOf(coverItem(it))} onError={url => covers.onError(coverItem(it), url)} onOpen={() => goSearch(it.title)} playBadge={ap} dbPlay={db} dbYear={db} />
                  ))}
                </div>
                {totalPages > 1 && (
                  <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
                    <button disabled={page <= 1 || bLoading} onClick={() => fetchPage(page - 1)}>上一页</button>
                    <span className="status">{page} / {totalPages}</span>
                    <button disabled={page >= totalPages || bLoading} onClick={() => fetchPage(page + 1)}>下一页</button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

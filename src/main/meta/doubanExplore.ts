// src/main/meta/doubanExplore.ts — 发现页「级联分类」的豆瓣数据层（★ 2026-10-15）
//
// 端点（实测 2026-10-15，全部 200）：
//   · 浏览：`https://m.douban.com/rexxar/api/v2/{movie|tv}/recommend
//            ?start=<偏移>&count=<条数>&sort=<T|U|R|S>&tags=<逗号分隔的豆瓣 tag>`
//     返回 { items, total, start, count, recommend_categories, sorts }；
//     `total` 上限 500 ⇒ 分页按 start 偏移，`start+count>=total` 即到底。
//   · 词表：同一响应的 `recommend_categories`（类型/地区）与 `sorts` 即是豆瓣自己的「选影视」选项表
//     ⇒ 直接当级联词表用，保证「每个选项都是豆瓣认得的 tag」，两页选项也永远一致。
//
// 条目形状（实测）：影片 `type:'movie'|'tv'` + `pic.large` + `rating.value` + `card_subtitle` 首段是年份；
//   榜单/豆列条目 `type:'chart'`（无封面）→ **必须按 `type` 过滤掉**，否则会把「高分经典喜剧片榜」当影片。
// 封面走本地 /img 中继（豆瓣图床对渲染层直连有防盗链）。
import { LOCAL_PROXY_BASE } from '../../shared/constants';
import {
  ALL_TAG,
  DOUBAN_SORTS,
  MOVIE_GENRES,
  MOVIE_REGIONS,
  TV_REGIONS,
  TV_SUBTYPES,
  discoverYearValues,
  type ExploreDimension,
  type ExplorePage,
  type ExploreQuery,
  type ExploreSort,
  type ExploreVocab,
  type ExploreVocabulary,
} from '../../shared/discover';
import type { DiscoverItem, Logger } from '../../shared/types';
import { doubanJson } from './doubanProvider';

const B = 'https://m.douban.com/rexxar/api/v2';
const IMG_PROXY = `${LOCAL_PROXY_BASE}/img`;
const PAGE_SIZE = 20;
/** 豆瓣 total 上限（接口自身封顶 500） */
const MAX_TOTAL = 500;
// 分类接口独立计数；封面搜索的 403 不会暂停分类浏览。
const exploreBreakers = new Map<'movie' | 'tv', { failures: number; until: number }>();
function exploreBlockedUntil(mediaType: 'movie' | 'tv'): number {
  const until = exploreBreakers.get(mediaType)?.until || 0;
  return Date.now() < until ? until : 0;
}
function noteExploreStatus(mediaType: 'movie' | 'tv', status: number): boolean {
  if (status === 200) { exploreBreakers.delete(mediaType); return false; }
  if (status !== 403 && status !== 429) return false;
  const previous = exploreBreakers.get(mediaType);
  const failures = (previous?.until && Date.now() >= previous.until ? 0 : previous?.failures || 0) + 1;
  const until = failures >= 3 ? Date.now() + 10 * 60 * 1000 : 0;
  exploreBreakers.set(mediaType, { failures, until });
  return until > 0;
}

interface RawItem {
  id?: string | number;
  title?: string;
  type?: string;
  card_subtitle?: string;
  cover_url?: string;
  pic?: { large?: string; normal?: string };
}

/** 卡片副标题首段拿年份（「2018 / 文牧野 徐峥…」→ 2018；「2018-05-01 / …」→ 2018） */
export function yearFromCardSubtitle(sub: string): number | '' {
  const m = /\b(19|20)\d{2}\b/.exec(sub || '');
  return m ? Number(m[0]) : '';
}

/**
 * 解析 `{mediaType}/recommend` 响应 → 发现页条目（纯函数，供单测）。
 * 只保留 `type` 与媒体类型一致的**影片**条目（榜单/豆列 `type='chart'` 丢弃），且必须有封面。
 */
export function parseDoubanExplore(json: unknown, mediaType: 'movie' | 'tv'): DiscoverItem[] {
  const j = json as { items?: unknown } | null;
  const items = j?.items;
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>();
  const out: DiscoverItem[] = [];
  for (const raw of items as RawItem[]) {
    if (!raw || typeof raw !== 'object') continue;
    if (raw.type !== mediaType) continue; // 丢掉 chart / 别类型条目
    const title = String(raw.title ?? '').trim();
    const id = String(raw.id ?? '').trim();
    const cover = String(raw.pic?.large || raw.pic?.normal || raw.cover_url || '').trim();
    if (!title || !/^https?:\/\//i.test(cover)) continue;
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    out.push({
      title,
      year: yearFromCardSubtitle(String(raw.card_subtitle ?? '')),
      poster: `${IMG_PROXY}?u=${encodeURIComponent(cover)}`,
      mediaType,
      ...(/^\d+$/.test(id) ? { doubanId: id } : {}),
    });
  }
  return out;
}

/** 解析豆瓣自带的选项表（纯函数，供单测）：`recommend_categories` + `sorts` → 级联词表 */
export function parseDoubanVocab(json: unknown, mediaType: 'movie' | 'tv'): ExploreVocab {
  const j = json as { recommend_categories?: unknown; sorts?: unknown } | null;
  const cats = Array.isArray(j?.recommend_categories) ? (j!.recommend_categories as Array<{ type?: string; data?: unknown }>) : [];
  const pick = (name: string): string[] => {
    const c = cats.find((x) => String(x?.type ?? '') === name);
    if (!Array.isArray(c?.data)) return [];
    return (c!.data as Array<{ text?: unknown }>).map((d) => String(d?.text ?? '').trim()).filter((t) => t && t !== '类型');
  };
  const merge = (list: string[]): string[] => [ALL_TAG, ...list.filter((v) => v !== ALL_TAG).filter((v, i, a) => a.indexOf(v) === i)];
  const dimensions: ExploreDimension[] = [];
  if (mediaType === 'movie') {
    const genres = pick('类型');
    dimensions.push({ key: '类型', label: '类型', values: merge(genres.length ? genres : MOVIE_GENRES) });
  } else {
    // 豆瓣 tv 的「类型」只有 电视剧/综艺（= 我们的一级分类）⇒ 这里给更细的剧集子类
    dimensions.push({ key: '类型', label: '类型', values: [ALL_TAG, ...TV_SUBTYPES] });
  }
  const regions = pick('地区');
  dimensions.push({
    key: '地区',
    label: '地区',
    values: merge(regions.length ? regions : (mediaType === 'movie' ? MOVIE_REGIONS : TV_REGIONS)),
  });
  dimensions.push({ key: '年代', label: '年代', values: discoverYearValues() });

  const sortsRaw = Array.isArray(j?.sorts) ? (j!.sorts as Array<{ name?: unknown; text?: unknown; checked?: unknown }>) : [];
  const sorts: ExploreSort[] = sortsRaw
    .map((s) => ({ id: String(s?.name ?? '').trim(), label: String(s?.text ?? '').trim() }))
    .filter((s) => s.id && s.label);
  const defaultSort = String(sortsRaw.find((s) => s?.checked)?.name ?? '').trim() || sorts[0]?.id || 'T';
  return { dimensions, sorts: sorts.length ? sorts : DOUBAN_SORTS, defaultSort };
}

/** 组装 recommend 查询串（纯函数，供单测）：`全部` 不下发；tags 逗号连接 */
export function buildExploreUrl(mediaType: 'movie' | 'tv', q: ExploreQuery): string {
  const tags = (q.tags || []).map((t) => String(t).trim()).filter((t) => t && t !== ALL_TAG);
  const count = Math.max(1, Math.min(50, Number(q.count) || PAGE_SIZE));
  const start = Math.max(0, Math.min(MAX_TOTAL, Number(q.start) || 0));
  const params = new URLSearchParams({ start: String(start), count: String(count), tags: tags.join(',') });
  if (q.sort) params.set('sort', String(q.sort));
  return `${B}/${mediaType}/recommend?${params.toString()}`;
}

const PAGE_TTL_MS = 6 * 3600 * 1000;
const pageCache = new Map<string, { t: number; data: ExplorePage }>();

/**
 * 取一页豆瓣分类浏览。403/429 走与「豆瓣兜底」同一套熔断（省得被风控拖死）。
 * 失败原因传给渲染层；已加载列表在重试期间保留。
 */
export async function doubanExplorePage(logger: Logger, q: ExploreQuery): Promise<ExplorePage> {
  const mediaType: 'movie' | 'tv' = q.mediaType === 'tv' ? 'tv' : 'movie';
  const url = buildExploreUrl(mediaType, q);
  const c = pageCache.get(url);
  if (!q.refresh && c && Date.now() - c.t < PAGE_TTL_MS) return c.data;
  const blockedUntil = exploreBlockedUntil(mediaType);
  if (blockedUntil) throw new Error('豆瓣分类暂时限制访问，请约 ' + Math.ceil((blockedUntil - Date.now()) / 60000) + ' 分钟后重试');
  try {
    const resp = await doubanJson(url, 12000);
    if (resp.status !== 200) {
      if (resp.status !== 0 && noteExploreStatus(mediaType, resp.status)) logger.w(`meta:豆瓣 分类浏览连续风控(status=${resp.status})，暂停豆瓣请求`);
      throw new Error(resp.status === 0 ? '豆瓣分类连接超时或网络不可用，请稍后重试' : '豆瓣分类请求失败（HTTP ' + resp.status + '），请稍后重试');
    }
    noteExploreStatus(mediaType, 200);
    const json = JSON.parse(resp.text) as { total?: unknown; start?: unknown; items?: unknown };
    if (!Array.isArray(json.items)) throw new Error('豆瓣分类返回的数据不完整，请稍后重试');
    const items = parseDoubanExplore(json, mediaType);
    const start = Math.max(0, Number(json?.start) || Number(q.start) || 0);
    const total = Math.max(0, Number(json?.total) || 0);
    const rawCount = Array.isArray(json.items) ? json.items.length : 0;
    const nextStart = Math.min(MAX_TOTAL, start + rawCount);
    const data: ExplorePage = { items, start, nextStart, total, hasMore: rawCount > 0 && nextStart < Math.min(total, MAX_TOTAL) };
    if (pageCache.size >= 200) {
      const first = pageCache.keys().next().value;
      if (first !== undefined) pageCache.delete(first);
    }
    pageCache.set(url, { t: Date.now(), data });
    return data;
  } catch (e) {
    logger.w(`meta:豆瓣 分类浏览失败: ${(e as Error).message}`);
    throw e;
  }
}

const VOCAB_TTL_MS = 24 * 3600 * 1000;
let vocabCache: { t: number; data: ExploreVocabulary } | null = null;

/** 豆瓣在线词表（类型/地区/排序），24h 内存缓存；任一路失败即回退内置快照 */
export async function doubanExploreVocabulary(logger: Logger): Promise<ExploreVocabulary> {
  if (vocabCache && Date.now() - vocabCache.t < VOCAB_TTL_MS) return vocabCache.data;
  const one = async (mediaType: 'movie' | 'tv'): Promise<ExploreVocab | null> => {
    if (exploreBlockedUntil(mediaType)) return null;
    const resp = await doubanJson(buildExploreUrl(mediaType, { mediaType, tags: [], count: 1, start: 0 }), 10000);
    if (resp.status !== 200) {
      if (resp.status !== 0 && noteExploreStatus(mediaType, resp.status)) logger.w(`meta:豆瓣 词表连续风控(status=${resp.status})`);
      return null;
    }
    noteExploreStatus(mediaType, 200);
    try { return parseDoubanVocab(JSON.parse(resp.text), mediaType); } catch { return null; }
  };
  try {
    const [movie, tv] = await Promise.all([one('movie'), one('tv')]);
    if (movie && tv) {
      const data: ExploreVocabulary = { movie, tv, source: 'douban' };
      vocabCache = { t: Date.now(), data };
      return data;
    }
    logger.w('meta:豆瓣 词表不全，使用内置快照');
    return { ...BUILTIN_VOCAB_LOCAL, source: 'builtin' };
  } catch (e) {
    logger.w(`meta:豆瓣 词表异常: ${(e as Error).message}`);
    return { ...BUILTIN_VOCAB_LOCAL, source: 'builtin' };
  }
}

/** 内置快照（与 shared/discover.ts 的 BUILTIN_VOCAB 同源；此处单列避免循环依赖担忧） */
const BUILTIN_VOCAB_LOCAL: ExploreVocabulary = {
  movie: {
    dimensions: [
      { key: '类型', label: '类型', values: [ALL_TAG, ...MOVIE_GENRES] },
      { key: '地区', label: '地区', values: [ALL_TAG, ...MOVIE_REGIONS] },
      { key: '年代', label: '年代', values: discoverYearValues() },
    ],
    sorts: DOUBAN_SORTS,
    defaultSort: 'T',
  },
  tv: {
    dimensions: [
      { key: '类型', label: '类型', values: [ALL_TAG, ...TV_SUBTYPES] },
      { key: '地区', label: '地区', values: [ALL_TAG, ...TV_REGIONS] },
      { key: '年代', label: '年代', values: discoverYearValues() },
    ],
    sorts: DOUBAN_SORTS,
    defaultSort: 'T',
  },
  source: 'builtin',
};

/** 测试用：清空内存缓存 */
export function __resetDoubanExploreForTest(): void {
  pageCache.clear();
  exploreBreakers.clear();
  vocabCache = null;
}

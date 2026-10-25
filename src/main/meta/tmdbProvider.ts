// src/main/meta/tmdbProvider.ts — TMDB 元数据补全：按名称+年份搜索 → 封面(poster)/简介(overview)。
// 链路：渲染层「缺封面/缺简介」→ IPC meta:search → SpiderHost.metaSearch →
//       本模块（内存 LRU → 磁盘缓存 MetaStore → TMDB API）。
// 网络：经 DnsResolver 的 DoH Agent（api.themoviedb.org 本机 DNS 被污染，DoH 解析后实测可达）。
import { request as undiciRequest } from 'undici';
import { createDohAgent } from '../net/DnsResolver';
import { dispatchChain } from '../net/proxy';
import { LOCAL_PROXY_BASE } from '../../shared/constants';
import type { Logger } from '../../shared/types';
import type { MetaHit, MetaExtra, DiscoverItem, DiscoverSection, DiscoverGenre, DiscoverGenrePage } from '../../shared/types';
import type { MetaStore } from './MetaStore';
import type { MetaSuggestion } from '../../shared/meta';
import type { MetaImages } from '../../shared/types';
import { BOARD_PAGE_SIZE, TMDB_BOARDS, normalizeBoardPage, type DiscoverBoardPage } from '../../shared/discoverBoards';
import { MAX_QUERY_ROUNDS, MAX_QUERY_VARIANTS, metaCacheKey, metaQueryVariants, titleMatches } from './tmdbSearchPolicy';
import { DEFAULT_IMAGE_BASE, parseGenreList, parseGenrePage, parseTmdbExtras, parseTmdbImages, parseTmdbSearch, toDiscoverItems } from './tmdbResponseParsers';
export { parseGenreList, parseGenrePage, parseTmdbExtras, parseTmdbImages, parseTmdbSearch, toDiscoverItems } from './tmdbResponseParsers';
export type { TmdbExtrasRaw } from './tmdbResponseParsers';
export { metaCacheKey, metaQueryName, metaQueryVariants, titleMatches, truncAtYear } from './tmdbSearchPolicy';

const agent = createDohAgent();
/** 内置默认 API 地址（用户可在配置页填「API 代理地址」覆盖） */
const DEFAULT_API = 'https://api.themoviedb.org/3';
/** 内置默认图床前缀（w342：列表卡片量级，体积/清晰度均衡；用户可填「图片镜像地址」覆盖） */
/** 渲染层经本地中继出图（主进程 DoH 可达、渲染层直连 image.tmdb.org 可能被 DNS 污染 → 图裂） */
const IMG_PROXY = `${LOCAL_PROXY_BASE}/img`;

/**
 * ★ 2026-09-24：运行时可配置（宿主按用户设置注入）——
 *   userKey  ：用户自填 API Key（v3）或 v4 读访问令牌；空 = 禁用 TMDB
 *   apiBase  ：API 代理地址；空 = 内置默认
 *   imageBase：图片镜像地址；空 = 内置默认
 * 未配置用户凭据时不访问 TMDB，也不读取历史 TMDB 缓存。
 */
export interface TmdbRuntimeConfig {
  userKey: string;
  apiBase: string;
  imageBase: string;
}
let rt: TmdbRuntimeConfig = { userKey: '', apiBase: '', imageBase: '' };
let runtimeRevision = 0;
export function setTmdbRuntime(next: Partial<TmdbRuntimeConfig>): void {
  if (Object.entries(next).some(([key, value]) => rt[key as keyof TmdbRuntimeConfig] !== value)) runtimeRevision++;
  rt = { ...rt, ...next };
}

const trimSlash = (s: string): string => (s || '').trim().replace(/\/+$/, '');
/** 生效的 API 地址 */
export function tmdbApiBase(): string {
  return trimSlash(rt.apiBase) || DEFAULT_API;
}
/** 生效的图床前缀 */
export function tmdbImageBase(): string {
  return trimSlash(rt.imageBase) || DEFAULT_IMAGE_BASE;
}
/**
 * 图床**根**（去掉尾部尺寸段）—— 用于需要换尺寸的场景（如 Hero 剧照用 w1280）。
 * ★ 2026-09-24 修复：`tmdbImageBase()` 默认已含 `/w342`，直接拼 `/w1280` 会得到
 *   `…/t/p/w342/w1280/x.jpg`（404）。这里剥掉尾部 `/w数字` 或 `/original` 再拼目标尺寸。
 */
export function tmdbImageBaseRoot(): string {
  return tmdbImageBase().replace(/\/(?:w\d+|h\d+|original)$/i, '');
}
/** 用户是否已填自己的 TMDB 凭据（「仅 TMDB」策略以此为准） */
export function hasUserTmdbKey(): boolean {
  return !!rt.userKey.trim();
}

/** 仅接受用户配置的凭据；eyJ 前缀按 v4 令牌走 Bearer，否则按 v3 Key 走查询参数。 */
export interface TmdbCred {
  bearer: string;
  apiKey: string;
  viaUser: boolean;
}
export function tmdbCreds(): TmdbCred | null {
  const k = (rt.userKey || '').trim();
  if (k) {
    return k.startsWith('eyJ') ? { bearer: k, apiKey: '', viaUser: true } : { bearer: '', apiKey: k, viaUser: true };
  }
  return null;
}

/** 把鉴权拼到请求上：v4 令牌走 Authorization 头，v3 Key 走 api_key 查询参数 */
function authFor(url: string, cred: TmdbCred): { url: string; bearer: string } {
  if (cred.bearer) return { url, bearer: cred.bearer };
  if (!cred.apiKey) return { url, bearer: '' };
  return { url: url + (url.includes('?') ? '&' : '?') + 'api_key=' + encodeURIComponent(cred.apiKey), bearer: '' };
}

/** 内存 LRU（防重复打 API；disk 缓存由 MetaStore 承担） */
const MAX_MEM = 1000;
const memCache = new Map<string, MetaHit | null>();

/** 查询结果是否可用的兜底判断 */
interface TmdbSearchResp {
  status: number;
  text: string;
}

async function getJson(url: string, bearer: string, headersTimeoutMs: number): Promise<TmdbSearchResp> {
  try {
    const headers = {
      accept: 'application/json',
      'User-Agent': 'Win-Box/0.72',
      // v3 Key 场景不带 Authorization（鉴权已在 URL 的 api_key 参数上）
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    };
    // ★ 2026-09-25：出站链 —— 用户设了网络代理则优先走代理（TMDB 在部分网络只有代理可达），
    //   否则退回 DoH Agent（本机 DNS 对 api.themoviedb.org 被污染）。
    let lastErr = '';
    for (const dispatcher of dispatchChain(url, agent)) {
      try {
        const r = await undiciRequest(url, {
          method: 'GET',
          headers,
          headersTimeout: headersTimeoutMs,
          bodyTimeout: headersTimeoutMs,
          dispatcher,
        });
        const text = Buffer.from(await r.body.arrayBuffer()).toString('utf-8');
        return { status: r.statusCode, text };
      } catch (e) {
        lastErr = (e as Error).message || String(e);
      }
    }
    return { status: 0, text: lastErr };
  } catch (e) {
    return { status: 0, text: (e as Error).message || String(e) };
  }
}

/**
 * 校验 TMDB 图床图片真实可读（GET + Range bytes=0-255，经 DoH Agent）。
 * ★ 2026-09-19 修复：此前用 HEAD，部分 CDN/图床拒绝 HEAD（405/403）→ 好图被误判坏图、
 *   命中拿不到封面（「TMDB 没搞定」的现象之一）。GET+小 Range 更接近真实出图路径：
 *   - 响应 200/206 且 Content-Type 是 image/* 判为好图（假 poster 404 返回 text/html 不会误判）；
 *   - 只读首片断流，避免把整张图下完。
 * ★ 2026-09-18：此前未校验，把「URL 拿到了但图实际打不开」的封面也当成功
 *   （渲染层直连 image.tmdb.org 被 DNS 污染 → 图裂且被误缓存）。坏图不命中、不缓存。
 */
/** 图床主机白名单：生效的镜像主机（用户可填）+ 官方 image.tmdb.org */
function posterHostAllowed(url: string): boolean {
  try {
    const host = new URL(url).host.toLowerCase();
    let allowed = 'image.tmdb.org';
    try {
      allowed = new URL(tmdbImageBase()).host.toLowerCase();
    } catch {
      /* 用户填的地址不合法 → 只认官方 */
    }
    return host === allowed || host === 'image.tmdb.org';
  } catch {
    return false;
  }
}

async function verifyPoster(url: string): Promise<boolean> {
  // ★ 2026-09-24：图床白名单改为「生效的图床主机」（含用户填的镜像地址）+ 官方 tmdb 主机
  if (!posterHostAllowed(url)) return false;
  try {
    // ★ 同 getJson：有代理走代理（图床同样可能被墙），否则 DoH
    for (const dispatcher of dispatchChain(url, agent)) {
      try {
        const r = await undiciRequest(url, {
          method: 'GET',
          headers: { accept: 'image/*', 'User-Agent': 'Win-Box/0.74', Range: 'bytes=0-255' },
          headersTimeout: 8000,
          bodyTimeout: 8000,
          dispatcher,
        });
        const ct = String(r.headers['content-type'] || '');
        const okStatus = r.statusCode === 200 || r.statusCode === 206;
        if (okStatus && /^image\//i.test(ct)) {
          // 只消费首块即断流（存于 CDN 的图片可能不理会 Range 返回整图）
          try {
            const reader = (r.body as unknown as AsyncIterable<any>)[Symbol.asyncIterator]();
            const first = await reader.next().catch(() => undefined);
            if (first && !first.done) await reader.return?.();
            return true;
          } catch {
            await r.body.dump().catch(() => undefined);
            return true;
          }
        }
        await r.body.dump().catch(() => undefined);
      } catch {
        /* 该 dispatcher 失败 → 试下一个（代理挂了好歹还能直连试一次） */
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * 按名称查询 TMDB（movie + tv 并行），返回最优 MetaHit 或 null。
 * - 内置凭据缺失 → 立即返回 null（不请求）；
 * - ★ 查询计划（2026-09-23 提升命中率，「封面总有几个补不上」的主要治因）：
 *     ① 原名 + 年份（年份可能是源站 remarks 误判 → 单独一轮去年份重试）
 *     ② 原名不带年份
 *     ③ 净化名（去「第1季/更新至N集/4K…」等尾部噪声、括号标签、取主标题）逐轮退让
 *   轮数上限 MAX_QUERY_ROUNDS，避免个别查不到的名字把 API 打爆；
 * - 命中的封面必须经 verifyPoster 真实可读；坏图跳过该候选，找到下一个可用的；
 * - 命中写缓存（主键 + 本轮键，带 vv=校验时间，超 24h 自动重新校验）；全 miss 写短 TTL miss。
 */
export async function tmdbSearchTitle(
  store: MetaStore,
  logger: Logger,
  name: string,
  year?: string,
  opts?: { forceFresh?: boolean },
): Promise<MetaHit | null> {
  const cred = tmdbCreds();
  const variants = metaQueryVariants(name || '').slice(0, MAX_QUERY_VARIANTS);
  if (!cred || variants.length === 0) return null;
  const primaryKey = metaCacheKey(variants[0], year);

  // ★ forceFresh：跳过缓存直接重查（2026-09-24 详情页增强用 —— 老缓存条目没有 tmdbId，
  //   需要一次「带 id」的新结果才能查演职员/推荐；结果照常写回缓存）
  // ★ 缓存也要过同名校验：此前已缓存的「误匹配」（如 韩国制造 → 韩国制造的我）视为 miss 重查，
  //   否则要等 7 天 TTL 才自愈（本轮修复 2026-09-24）
  const usableHit = (h: MetaHit | null | undefined): h is MetaHit =>
    !!h && (titleMatches(variants[0], h.title) || titleMatches(name, h.title));

  if (!opts?.forceFresh) {
    // 内存 LRU
    if (memCache.has(primaryKey)) {
      const m = memCache.get(primaryKey);
      if (usableHit(m)) return m;
      memCache.delete(primaryKey);
    }

    // 磁盘缓存（命中且 vv 未过期才直接返回；旧/过期缓存返回 undefined 触发重查+重校验）
    const disk = store.cacheGet(primaryKey);
    if (disk && disk.hit && usableHit(disk.hit)) {
      memSet(primaryKey, disk.hit);
      return disk.hit;
    }
  }

  const y0 = (year || '').trim().replace(/\D/g, '');
  const year4 = /^\d{4}$/.test(y0) ? y0 : '';
  // 查询计划：带年份 → 去年份 → 净化名（净化名不再带年份：此时更可能是源站标记串，年份多半也不准）
  const plan: Array<{ q: string; y: string }> = [];
  if (year4) plan.push({ q: variants[0], y: year4 });
  plan.push({ q: variants[0], y: '' });
  for (const v of variants.slice(1)) {
    if (plan.length >= MAX_QUERY_ROUNDS) break;
    plan.push({ q: v, y: '' });
  }

  let anyError = false;
  const verifiedAt = Date.now();
  for (const round of plan) {
    const q = encodeURIComponent(round.q);
    const api = tmdbApiBase();
    const movieUrl = `${api}/search/movie?query=${q}&language=zh-CN${round.y ? `&year=${round.y}` : ''}&include_adult=false`;
    const tvUrl = `${api}/search/tv?query=${q}&language=zh-CN${round.y ? `&first_air_date_year=${round.y}` : ''}&include_adult=false`;
    const am = authFor(movieUrl, cred);
    const at = authFor(tvUrl, cred);
    const [mv, tv] = await Promise.all([getJson(am.url, am.bearer, 12000), getJson(at.url, at.bearer, 12000)]);

    // ★ 2026-09-19 修复：HTTP 非 200 的「服务端错误」（401/403/429/5xx/网络失败）**不写 miss 缓存**。
    //   此前一律当"查询无结果"缓存 1 天 → 限流/凭据抖动会让整批资源封面白等一天（"大部分资源缺封面"的常见根因）。
    //   只有「至少一个请求 200 且解析出空结果」才是真 miss（可缓存）；错误类返回 null 但不落缓存，下次翻页自动重试。
    const candidates: MetaHit[] = [];
    for (const resp of [mv, tv]) {
      if (resp.status === 200) {
        try {
          const kind = resp === mv ? 'movie' : 'tv';
          candidates.push(...parseTmdbSearch(JSON.parse(resp.text), kind as 'movie' | 'tv', tmdbImageBase()));
        } catch { /* json 异常忽略 */ }
      } else if (resp.status === 404) {
        // 404 视为真无结果（罕见），按 miss 缓存
      } else if (resp.status !== 0) {
        anyError = true;
        logger.w(`meta:TMDB ${resp === mv ? 'movie' : 'tv'} 失败 status=${resp.status} ${resp.text.slice(0, 200)}`);
      }
    }
    // 错误类（非 200/404）出现 → 本轮不落缓存，返回 null 让调用方下次重试
    if (mv.status !== 200 && tv.status !== 200 && (mv.status !== 404 || tv.status !== 404)) anyError = true;

    let hit: MetaHit | null = null;
    for (const cand of candidates.slice(0, 6)) {
      // ★ 严格同名校验（见 titleMatches）：同名或仅差序号才算命中 —— 否则宁可 miss（不补错内容）
      if (!titleMatches(round.q, cand.title) && !titleMatches(name, cand.title)) continue;
      // 封面经本地 /img 中继出图（渲染层直连 image.tmdb.org 可能被污染）；先校验原始图真实可读
      if (await verifyPoster(cand.poster)) {
        hit = {
          ...cand,
          poster: `${IMG_PROXY}?u=${encodeURIComponent(cand.poster)}`,
          // ★ 横版剧照同样走中继（详情页背景兜底用；缺了就不带该字段）
          ...(cand.backdrop ? { backdrop: `${IMG_PROXY}?u=${encodeURIComponent(cand.backdrop)}` } : {}),
        };
        break;
      }
    }
    if (hit) {
      const roundKey = metaCacheKey(round.q, round.y);
      memSet(primaryKey, hit);
      store.cacheSet(primaryKey, hit, verifiedAt);
      if (roundKey !== primaryKey) store.cacheSet(roundKey, hit, verifiedAt); // 该变体下次直接命中
      return hit;
    }
  }

  if (anyError) {
    // 服务端错误 → 只记内存（防本页重复打），不写磁盘（TTL 短也尽量让下次可重试）
    memSet(primaryKey, null);
    return null;
  }
  memSet(primaryKey, null);
  store.cacheSet(primaryKey, null, verifiedAt); // hit=null 也缓存（miss，短 TTL）
  return null;
}

// ==================== 详情页增强：演职员 / 类型 / 相关推荐（★ 2026-09-24） ====================

/** 演职员/推荐缓存 TTL（详情页反复进出不重复打 API） */
const EXTRAS_TTL_MS = 24 * 3600 * 1000;
const MAX_CAST = 12;
const MAX_RECS = 12;
const extrasCache = new Map<string, { t: number; data: MetaExtra }>();

export async function tmdbExtras(
  store: MetaStore,
  logger: Logger,
  name: string,
  year?: string,
): Promise<MetaExtra | null> {
  const n = (name || '').trim();
  if (!n) return null;
  const cred = tmdbCreds();
  if (!cred) return null;
  try {
    let hit = await tmdbSearchTitle(store, logger, n, year);
    if (hit && !hit.tmdbId) hit = await tmdbSearchTitle(store, logger, n, year, { forceFresh: true });
    if (!hit?.tmdbId) return null;
    const mediaType: 'movie' | 'tv' = hit.type === 'tv' ? 'tv' : 'movie';
    const key = `${mediaType}:${hit.tmdbId}`;
    const c = extrasCache.get(key);
    if (c && Date.now() - c.t < EXTRAS_TTL_MS) return c.data;
    const detailUrl = `${tmdbApiBase()}/${mediaType}/${hit.tmdbId}?language=zh-CN&append_to_response=credits,recommendations`;
    const ad = authFor(detailUrl, cred);
    const resp = await getJson(ad.url, ad.bearer, 12000);
    if (resp.status !== 200) {
      logger.w(`meta:TMDB 详情(${key}) 失败 status=${resp.status} ${resp.text.slice(0, 120)}`);
      return null;
    }
    const raw = parseTmdbExtras(JSON.parse(resp.text), mediaType);
    const data: MetaExtra = {
      cast: raw.cast.slice(0, MAX_CAST),
      genres: raw.genres,
      recommendations: raw.recommendations
        .slice(0, MAX_RECS)
        .map((r) => ({ ...r, poster: `${IMG_PROXY}?u=${encodeURIComponent(`${tmdbImageBase()}${r.posterPath}`)}` }))
        .map(({ posterPath: _p, ...rest }) => rest),
      directors: raw.directors.slice(0, 4),
    };
    extrasCache.set(key, { t: Date.now(), data });
    return data;
  } catch (e) {
    logger.w(`meta:TMDB 详情查询异常: ${(e as Error).message}`);
    return null;
  }
}

const IMAGES_TTL_MS = 24 * 3600 * 1000;
const imagesCache = new Map<string, { t: number; data: MetaImages }>();

/** 取某部片的剧照/海报（发现页 Hero 轮播用）；失败返回空数组，绝不抛错 */
export async function tmdbImages(
  logger: Logger,
  mediaType: 'movie' | 'tv',
  tmdbId: number,
): Promise<MetaImages> {
  const empty: MetaImages = { backdrops: [], posters: [] };
  const cred = tmdbCreds();
  const id = Number(tmdbId);
  if (!cred || !Number.isFinite(id) || id <= 0) return empty;
  const key = `${mediaType}:${id}`;
  const c = imagesCache.get(key);
  if (c && Date.now() - c.t < IMAGES_TTL_MS) return c.data;
  try {
    const url = `${tmdbApiBase()}/${mediaType}/${id}/images?include_image_language=zh,en,null`;
    const au = authFor(url, cred);
    const resp = await getJson(au.url, au.bearer, 12000);
    if (resp.status !== 200) {
      logger.w(`meta:剧照(${key}) 失败 status=${resp.status} ${resp.text.slice(0, 120)}`);
      return empty;
    }
    const raw = parseTmdbImages(JSON.parse(resp.text));
    // ★ 用「图床根」拼目标尺寸：基址默认已含 /w342，必须剥掉再拼（否则 /w342/w1280/… 404）
    const root = tmdbImageBaseRoot();
    const wrap = (size: string, p: string): string => `${IMG_PROXY}?u=${encodeURIComponent(`${root}${size}${p}`)}`;
    const data: MetaImages = {
      backdrops: raw.backdrops.map((p) => wrap('/w1280', p)),
      posters: raw.posters.map((p) => wrap('/w342', p)),
    };
    if (data.backdrops.length || data.posters.length) imagesCache.set(key, { t: Date.now(), data });
    return data;
  } catch (e) {
    logger.w(`meta:剧照查询异常: ${(e as Error).message}`);
    return empty;
  }
}

// ==================== 发现页（无源时的默认主页；★ 2026-09-24） ====================

/** 发现页分区（TMDB 榜单；标题用中文，language=zh-CN 片名也走中文） */
const DISCOVER_SECTIONS: Array<{ id: string; title: string; path: string; mediaType: 'movie' | 'tv' }> = [
  { id: 'movie-popular', title: '热门电影', path: '/movie/popular', mediaType: 'movie' },
  { id: 'movie-upcoming', title: '即将上映', path: '/movie/upcoming', mediaType: 'movie' },
  { id: 'movie-top', title: '高分电影', path: '/movie/top_rated', mediaType: 'movie' },
  { id: 'tv-popular', title: '热门剧集', path: '/tv/popular', mediaType: 'tv' },
  { id: 'tv-top', title: '高分剧集', path: '/tv/top_rated', mediaType: 'tv' },
];
/** 榜单缓存 TTL：6h（榜单变化慢；重启/刷新按钮可绕过） */
const DISCOVER_TTL_MS = 6 * 3600 * 1000;
let discoverCache: { t: number; data: DiscoverSection[] } | null = null;
let discoverInflight: Promise<DiscoverSection[]> | null = null;
/** ★ 2026-09-25：分区级「最后一次成功结果」——整表刷新失败时按分区顶替，避免发现页整页空 */
const sectionCache = new Map<string, { t: number; data: DiscoverSection }>();

/**
 * 拉取发现页全部榜单（并行；单个分区失败只丢该分区）。
 * - 无内置凭据 → 返回空数组（渲染层提示「未内置凭据」而不是报错）；
 * - 结果内存缓存 6h；`refresh=true` 绕过缓存重拉；并发调用共享同一 in-flight promise。
 *
 * ★ 2026-09-25（用户报「发现页经常加载不出来 / 搜索没有热搜」）：
 *   TMDB 对本机是跨境访问，偶发 `Body/Headers Timeout`（日志实录）→ 此前一次失败就整页空，
 *   而发现页与搜索面板热搜共用本函数。现加两道保险：
 *   ① **分区级重试**（同一分区最多 2 次）—— 跨境抖动一次不再直接丢分区；
 *   ② **分区级最后一次成功结果兜底**（`sectionCache`）—— 仍失败的分区用上次的榜单顶上，
 *      保证「只要有网过，页面就有内容」（比整页空/空热搜好得多）。
 */
export async function tmdbDiscover(logger: Logger, refresh = false): Promise<DiscoverSection[]> {
  const cred = tmdbCreds();
  if (!cred) return [];
  if (!refresh && discoverCache && Date.now() - discoverCache.t < DISCOVER_TTL_MS) return discoverCache.data;
  if (discoverInflight) return discoverInflight;
  const task = (async (): Promise<DiscoverSection[]> => {
    const parts = await Promise.all(
      DISCOVER_SECTIONS.map(async (s) => {
        // ① 同一分区最多试 2 次（第 2 次给更长的超时，跨境慢链路更可能成功）
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const u = authFor(`${tmdbApiBase()}${s.path}?language=zh-CN&page=1`, cred);
            const resp = await getJson(u.url, u.bearer, attempt === 0 ? 12000 : 20000);
            if (resp.status !== 200) {
              logger.w(`meta:发现页 ${s.id} 失败 status=${resp.status} ${resp.text.slice(0, 120)}`);
              continue;
            }
            const items = toDiscoverItems(JSON.parse(resp.text), s.mediaType);
            if (items.length) {
              sectionCache.set(s.id, { t: Date.now(), data: { id: s.id, title: s.title, items } });
              return { id: s.id, title: s.title, items };
            }
          } catch (e) {
            logger.w(`meta:发现页 ${s.id} 异常(第${attempt + 1}次): ${(e as Error).message}`);
          }
        }
        // ② 两次都不成 → 用该分区上一次的成功结果兜底
        const last = sectionCache.get(s.id);
        if (last) {
          logger.w(`meta:发现页 ${s.id} 本次失败，用上次结果兜底（${last.data.items.length} 条）`);
          return last.data;
        }
        return null;
      }),
    );
    const out = parts.filter((x): x is DiscoverSection => x !== null);
    if (out.length) discoverCache = { t: Date.now(), data: out };
    return out;
  })();
  discoverInflight = task.catch(() => [] as DiscoverSection[]).finally(() => { discoverInflight = null; });
  return discoverInflight;
}

const BOARD_PATHS: Readonly<Record<string, string>> = {
  'movie-popular': '/movie/popular', 'movie-upcoming': '/movie/upcoming', 'movie-top': '/movie/top_rated',
  'tv-popular': '/tv/popular', 'tv-top': '/tv/top_rated',
  'movie-now-playing': '/movie/now_playing', 'tv-airing-today': '/tv/airing_today', 'tv-on-the-air': '/tv/on_the_air',
};
const boardPages = new Map<string, DiscoverBoardPage>();
const boardInflight = new Map<string, Promise<DiscoverBoardPage>>();

/** 榜单保留没有海报的项目，避免用封面完整程度改变列表顺序和数量。 */
function tmdbBoardItems(json: { results?: unknown }, mediaType: 'movie' | 'tv'): DiscoverItem[] {
  if (!Array.isArray(json.results)) throw new Error('TMDB 没有返回榜单内容');
  return json.results.flatMap((raw): DiscoverItem[] => {
    if (!raw || typeof raw !== 'object') return [];
    const item = raw as Record<string, unknown>;
    const title = String(item.title || item.name || '').trim();
    if (!title) return [];
    const year = String(item.release_date || item.first_air_date || '').match(/^\d{4}/)?.[0];
    const rating = Number(item.vote_average);
    const id = Number(item.id);
    const path = typeof item.poster_path === 'string' && item.poster_path.startsWith('/') ? item.poster_path : '';
    return [{ title, year: year ? Number(year) : '', mediaType,
      poster: path ? `${IMG_PROXY}?u=${encodeURIComponent(tmdbImageBase() + path)}` : '',
      ...(Number.isInteger(id) && id > 0 ? { tmdbId: id } : {}),
      ...(Number.isFinite(rating) && rating > 0 && rating <= 10 ? { rating } : {}),
    }];
  });
}

export async function tmdbBoardPage(logger: Logger, id: string, requestedPage: number, refresh = false): Promise<DiscoverBoardPage> {
  const board = TMDB_BOARDS.find(item => item.id === id);
  if (!board) throw new Error('没有找到这个 TMDB 榜单');
  const cred = tmdbCreds();
  if (!cred) throw new Error('请先在“设置 → 凭据”中配置自己的 TMDB 凭据');
  const page = normalizeBoardPage(requestedPage);
  const key = `${runtimeRevision}:${id}:${page}`;
  const old = boardPages.get(key);
  if (!refresh && old && Date.now() - old.fetchedAt < DISCOVER_TTL_MS) return old;
  const running = boardInflight.get(key);
  if (running) return running;
  const task = (async (): Promise<DiscoverBoardPage> => {
    try {
      const auth = authFor(`${tmdbApiBase()}${BOARD_PATHS[id]}?language=zh-CN&page=${page}`, cred);
      const response = await getJson(auth.url, auth.bearer, 12000);
      if (response.status !== 200) throw new Error(`TMDB 榜单请求失败（HTTP ${response.status}）`);
      const json = JSON.parse(response.text);
      const count = Number(json.total_results);
      const pages = Number(json.total_pages);
      const total = json.total_results != null && Number.isFinite(count) && count >= 0 ? Math.floor(count) : null;
      const totalPages = json.total_pages != null && Number.isFinite(pages) && pages >= 0 ? Math.max(1, Math.min(500, Math.floor(pages))) : null;
      const items = tmdbBoardItems(json, board.mediaType!);
      const data: DiscoverBoardPage = { board, items, page, pageSize: BOARD_PAGE_SIZE, total, totalPages,
        hasMore: items.length > 0 && page < 500 && (totalPages === null ? items.length >= BOARD_PAGE_SIZE : page < totalPages),
        fetchedAt: Date.now(), stale: false,
        ...(pages > 500 ? { notice: 'TMDB 接口最多支持浏览前 500 页；可前往原站继续查找。' } : {}),
      };
      boardPages.delete(key);
      boardPages.set(key, data);
      if (boardPages.size > 100) boardPages.delete(boardPages.keys().next().value!);
      return data;
    } catch (error) {
      logger.w(`meta:榜单 ${id} 第 ${page} 页读取失败`);
      if (old && Date.now() - old.fetchedAt < 30 * 86400000) return { ...old, stale: true, notice: '本次请求失败，正在显示上次成功加载的内容。' };
      throw new Error(error instanceof Error && error.message.startsWith('TMDB 榜单请求失败')
        ? error.message : '暂时无法读取 TMDB 榜单，请检查凭据、API 地址和网络');
    } finally {
      boardInflight.delete(key);
    }
  })();
  boardInflight.set(key, task);
  return task;
}

// ==================== 发现页「分类」浏览（★ 2026-09-24） ====================

const GENRES_TTL_MS = 24 * 3600 * 1000;
const GENRE_PAGE_TTL_MS = 6 * 3600 * 1000;
let genresCache: { t: number; data: { movie: DiscoverGenre[]; tv: DiscoverGenre[] } } | null = null;
const genrePageCache = new Map<string, { t: number; data: DiscoverGenrePage }>();

/**
 * 类型清单（电影 / 剧集两套，中文名；24h 内存缓存）。
 * 无凭据 → 返回空列表（渲染层隐藏分类区，不报错）。
 */
export async function tmdbGenres(logger: Logger): Promise<{ movie: DiscoverGenre[]; tv: DiscoverGenre[] }> {
  const empty = { movie: [] as DiscoverGenre[], tv: [] as DiscoverGenre[] };
  const cred = tmdbCreds();
  if (!cred) return empty;
  if (genresCache && Date.now() - genresCache.t < GENRES_TTL_MS) return genresCache.data;
  const one = async (type: 'movie' | 'tv'): Promise<DiscoverGenre[]> => {
    const u = authFor(`${tmdbApiBase()}/genre/${type}/list?language=zh-CN`, cred);
    const resp = await getJson(u.url, u.bearer, 10000);
    if (resp.status !== 200) {
      logger.w(`meta:类型清单(${type}) 失败 status=${resp.status}`);
      return [];
    }
    try { return parseGenreList(JSON.parse(resp.text)); } catch { return []; }
  };
  try {
    const [movie, tv] = await Promise.all([one('movie'), one('tv')]);
    const data = { movie, tv };
    if (movie.length || tv.length) genresCache = { t: Date.now(), data };
    return data;
  } catch (e) {
    logger.w(`meta:类型清单异常: ${(e as Error).message}`);
    return empty;
  }
}

/**
 * 按类型取一页（`/discover/{type}?with_genres=<id>&sort_by=popularity.desc&page=N`，中文）。
 * 6h 内存缓存（key=类型|id|页）；单类型条目上限 500 条缓存条目，超出丢最旧。
 */
export async function tmdbGenrePage(
  logger: Logger,
  mediaType: 'movie' | 'tv',
  genreId: number,
  page = 1,
): Promise<DiscoverGenrePage> {
  const empty: DiscoverGenrePage = { items: [], page: 1, totalPages: 1 };
  const cred = tmdbCreds();
  const id = Number(genreId);
  const pg = Math.max(1, Math.min(500, Number(page) || 1));
  if (!cred || !Number.isFinite(id) || id <= 0) return empty;
  const key = `${mediaType}|${id}|${pg}`;
  const c = genrePageCache.get(key);
  if (c && Date.now() - c.t < GENRE_PAGE_TTL_MS) return c.data;
  try {
    const url = `${tmdbApiBase()}/discover/${mediaType}?language=zh-CN&with_genres=${id}&sort_by=popularity.desc&include_adult=false&page=${pg}`;
    const au = authFor(url, cred);
    const resp = await getJson(au.url, au.bearer, 12000);
    if (resp.status !== 200) {
      logger.w(`meta:分类(${key}) 失败 status=${resp.status} ${resp.text.slice(0, 120)}`);
      return empty;
    }
    const data = parseGenrePage(JSON.parse(resp.text), mediaType);
    if (genrePageCache.size >= 500) {
      const first = genrePageCache.keys().next().value;
      if (first !== undefined) genrePageCache.delete(first);
    }
    genrePageCache.set(key, { t: Date.now(), data });
    return data;
  } catch (e) {
    logger.w(`meta:分类(${key}) 异常: ${(e as Error).message}`);
    return empty;
  }
}

/**
 * ★ 2026-09-24：搜索面板「自动联想」——`/search/multi` 取前 N 条（电影/剧集）。
 * 轻量：不校验封面、不写缓存（输入即查）；无凭据/失败返回空数组。
 */
export async function tmdbSuggest(logger: Logger, q: string, limit = 8): Promise<MetaSuggestion[]> {
  const cred = tmdbCreds();
  const term = (q || '').trim();
  if (!cred || !term) return [];
  const url = `${tmdbApiBase()}/search/multi?query=${encodeURIComponent(term)}&language=zh-CN&include_adult=false`;
  const au = authFor(url, cred);
  const resp = await getJson(au.url, au.bearer, 8000);
  if (resp.status !== 200) return [];
  const out: MetaSuggestion[] = [];
  try {
    const j = JSON.parse(resp.text) as { results?: Array<Record<string, unknown>> };
    for (const r of j.results || []) {
      const mt = String(r.media_type || '');
      if (mt !== 'movie' && mt !== 'tv') continue;
      const title = String(r.title ?? r.name ?? '').trim();
      if (!title) continue;
      const date = String(r.release_date ?? r.first_air_date ?? '');
      const y = /^(\d{4})/.exec(date)?.[1];
      out.push({ title, year: y ? Number(y) : '', mediaType: mt });
      if (out.length >= limit) break;
    }
  } catch {
    logger.w('meta:联想解析失败');
    return [];
  }
  return out;
}

function memSet(cacheKey: string, hit: MetaHit | null): void {
  if (memCache.size >= MAX_MEM) {
    const first = memCache.keys().next().value;
    if (first !== undefined) memCache.delete(first);
  }
  memCache.set(cacheKey, hit);
}

/** 测试用：清空内存缓存（封面/详情增强/发现页/分类/剧照五处） */
export function __resetMemCacheForTest(): void {
  memCache.clear();
  extrasCache.clear();
  discoverCache = null;
  genresCache = null;
  genrePageCache.clear();
  imagesCache.clear();
}

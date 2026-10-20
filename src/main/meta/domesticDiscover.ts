// 国内发现页与真实电影热搜：豆瓣公开榜单 + 百度电影热搜榜。
// 使用网站自身的网页接口（并非承诺稳定的开放 API）；失败保留磁盘数据，不绕过验证码。
import { Agent, request } from 'undici';
import { dispatchChain } from '../net/proxy';
import { createDohAgent } from '../net/DnsResolver';
import { JsonStore } from '../store/JsonStore';
import { LOCAL_PROXY_BASE } from '../../shared/constants';
import { BOARD_PAGE_SIZE, DOMESTIC_BOARDS, HOME_BOARD_IDS, normalizeBoardPage, type DiscoverBoardPage } from '../../shared/discoverBoards';
import type { DiscoverItem, DiscoverSection, DiscoverGenrePage, Logger, MovieHotList, MovieHotItem } from '../../shared/types';

const agent = new Agent({ connect: { timeout: 8000 } });
const dohFallback = createDohAgent();
const DOUBAN = 'https://m.douban.com/rexxar/api/v2/';
const HOT_URL = 'https://top.baidu.com/api/board?platform=wise&tab=movie';
const PAGE_SIZE = 20;
const TTL = 6 * 3600 * 1000;
const MAX_STALE = 30 * 86400 * 1000;

class DiscoverHttpError extends Error {
  constructor(readonly status: number) { super(`榜单请求失败 HTTP ${status}`); }
}

export type DiscoverJsonFetcher = (url: string) => Promise<unknown>;
export async function fetchDiscoverJson(url: string): Promise<unknown> {
  let last: unknown = new Error('榜单网络请求失败');
  // 用户配置代理优先；无代理时系统 DNS 失败再用 DoH，避免国内接口被单一解析链路拖死。
  for (const dispatcher of dispatchChain(url, agent, dohFallback)) {
    try {
      const r = await request(url, {
        dispatcher,
        headers: { 'User-Agent': 'Mozilla/5.0', accept: 'application/json', Referer: url.startsWith(DOUBAN) ? 'https://m.douban.com/' : 'https://top.baidu.com/' },
        headersTimeout: 8000, bodyTimeout: 8000,
        signal: AbortSignal.timeout(12000),
      });
      if (r.statusCode !== 200) {
        await r.body.dump();
        // HTTP 风控不是 DNS/连接问题，不重复换出口请求同一站点。
        throw new DiscoverHttpError(r.statusCode);
      }
      return await r.body.json();
    } catch (e) {
      last = e;
      if (e instanceof DiscoverHttpError) throw e;
    }
  }
  throw last;
}

/** 丢弃推荐结果中的 chart/ad 等条目，避免把“科幻榜”当成影片。 */
export function parseDomesticItems(json: unknown, mediaType: 'movie' | 'tv'): DiscoverItem[] {
  const j = json as any;
  const list = j?.subject_collection_items ?? j?.items;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  return list.flatMap((item: any): DiscoverItem[] => {
    if (!item || (item.type && item.type !== mediaType)) return [];
    const title = String(item.title ?? '').trim();
    const id = String(item.id ?? '');
    if (!title || seen.has(id || title)) return [];
    seen.add(id || title);
    const raw = String(item.pic?.large || item.pic?.normal || item.cover?.url || item.cover_url || '');
    const poster = /^https?:\/\//i.test(raw) ? `${LOCAL_PROXY_BASE}/img?${new URLSearchParams({ u: raw, ref: 'https://m.douban.com/' })}` : '';
    const y = String(item.year || '').match(/\b(19|20)\d{2}\b/)?.[0];
    const rating = Number(item.rating?.value);
    const rank = Number(item.rank);
    return [{ title, year: y ? Number(y) : '', poster, mediaType,
      ...(/^\d+$/.test(id) ? { doubanId: id } : {}),
      ...(Number.isFinite(rating) && rating > 0 && rating <= 10 ? { rating } : {}),
      ...(Number.isInteger(rank) && rank > 0 ? { rank } : {}),
    }];
  });
}

export function parseBaiduMovieHot(json: unknown): MovieHotItem[] {
  const j = json as any;
  if (j?.success !== true || !Array.isArray(j?.data?.cards)) return [];
  const out: MovieHotItem[] = [];
  const walk = (nodes: unknown): void => {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue;
      const n = node as any;
      if (Array.isArray(n.content)) walk(n.content);
      const title = String(n.title ?? '').trim();
      const rank = Number(n.index);
      // 仅使用榜单带排名、指数的电影；不把导航文字/顶置新闻混进来。
      if (title && Number.isInteger(rank) && rank > 0 && n.hotScore?.value != null && !out.some(i => i.title === title)) {
        out.push({ title, rank, score: String(n.hotScore.value) });
      }
    }
  };
  walk(j.data.cards);
  return out.sort((a, b) => a.rank - b.rank).slice(0, 50);
}

// 与 TMDB 类型编号彻底解耦；编号只用于本地标签映射。
export const DOMESTIC_GENRES = {
  movie: ['剧情', '喜剧', '动作', '爱情', '科幻', '动画', '悬疑', '惊悚', '恐怖', '纪录片', '犯罪', '战争', '奇幻', '冒险'],
  tv: ['国产剧', '美剧', '英剧', '韩剧', '日剧', '港剧', '剧情', '喜剧', '爱情', '悬疑', '犯罪', '古装', '科幻', '动画'],
};
const SECTIONS = DOMESTIC_BOARDS.filter(board => (HOME_BOARD_IDS as readonly string[]).includes(board.id));

interface Entry<T> { at: number; value: T }
/** 先读磁盘成功结果、后台刷新；并发合并、失败一分钟退避，重启也不会丢榜单。 */
export class DomesticDiscover {
  private inflight = new Map<string, Promise<Entry<any>>>();
  private retryAt = new Map<string, number>();
  private doubanQueue: Promise<unknown> = Promise.resolve();
  private blockedUntil = new Map<string, number>();
  private blockedCount = new Map<string, number>();
  constructor(private store: JsonStore, private log: Logger, private fetcher: DiscoverJsonFetcher = fetchDiscoverJson) {}

  private fetch(url: string): Promise<unknown> {
    const host = new URL(url).hostname;
    const run = async () => {
      if (Date.now() < (this.blockedUntil.get(host) || 0)) throw new Error('榜单访问受限，暂缓请求');
      try {
        const result = await this.fetcher(url);
        this.blockedCount.delete(host);
        return result;
      } catch (e) {
        if ([403, 429].includes(Number((e as DiscoverHttpError)?.status))) {
          const count = (this.blockedCount.get(host) || 0) + 1;
          this.blockedCount.set(host, count);
          if (count >= 3) this.blockedUntil.set(host, Date.now() + 10 * 60000);
        }
        throw e;
      }
    };
    // 豆瓣分区串行，风控后停止余下请求，不并发冲击同一站点。
    if (!url.startsWith(DOUBAN)) return run();
    const next = this.doubanQueue.then(run, run);
    this.doubanQueue = next.catch(() => undefined);
    return next;
  }

  private async cached<T>(key: string, ttl: number, load: () => Promise<T>, valid: (value: T) => boolean, empty: T, refresh = false): Promise<Entry<T>> {
    const previous = this.store.getObject<Entry<T> | null>(key, null);
    const old = previous && Number.isFinite(previous.at) && Date.now() - previous.at < MAX_STALE && valid(previous.value) ? previous : null;
    const fresh = old && Date.now() - old.at < ttl;
    if (!refresh && fresh) return old;
    const update = (): Promise<Entry<T>> => {
      const running = this.inflight.get(key);
      if (running) return running;
      if (Date.now() < (this.retryAt.get(key) || 0)) return Promise.resolve(old || { at: 0, value: empty });
      const job = Promise.resolve().then(load).then(value => {
        if (!valid(value)) throw new Error('榜单未返回有效内容');
        const entry = { at: Date.now(), value };
        this.store.setObject(key, entry);
        this.store.flush();
        this.retryAt.delete(key);
        return entry;
      }).catch(e => {
        this.log.w(`国内发现页 ${key}: ${(e as Error).message}`);
        this.retryAt.set(key, Date.now() + 60000);
        return old || { at: 0, value: empty };
      }).finally(() => this.inflight.delete(key));
      this.inflight.set(key, job);
      return job;
    };
    if (old && !refresh) { void update(); return old; }
    return update();
  }

  async hot(): Promise<MovieHotList> {
    const entry = await this.cached<MovieHotItem[]>('movie-hot', 3600000, async () => parseBaiduMovieHot(await this.fetch(HOT_URL)), v => Array.isArray(v) && v.length > 0, []);
    return { source: 'baidu', items: entry.value, fetchedAt: entry.at, stale: !entry.at || Date.now() - entry.at >= 3600000 };
  }

  async discover(refresh = false): Promise<DiscoverSection[]> {
    const parts = await Promise.all(SECTIONS.map(async section => {
      const e = await this.cached<DiscoverItem[]>(`section:${section.id}`, TTL,
        async () => parseDomesticItems(await this.fetch(`${DOUBAN}subject_collection/${section.id}/items?start=0&count=${PAGE_SIZE}`), section.mediaType!),
        v => Array.isArray(v) && v.length > 0, [], refresh);
      return { id: section.id, title: section.title, items: e.value, fetchedAt: e.at, stale: !e.at || Date.now() - e.at >= TTL };
    }));
    return parts.filter(s => s.items.length);
  }

  async boardPage(id: string, requestedPage: number, refresh = false): Promise<DiscoverBoardPage> {
    const board = DOMESTIC_BOARDS.find(item => item.id === id);
    if (!board) throw new Error('没有找到这个豆瓣榜单');
    const page = normalizeBoardPage(requestedPage);
    const start = (page - 1) * BOARD_PAGE_SIZE;
    const key = `board:${id}:${page}`;
    type Content = Omit<DiscoverBoardPage, 'fetchedAt' | 'stale'>;
    const entry = await this.cached<Content | null>(key, TTL, async () => {
      const json = await this.fetch(`${DOUBAN}subject_collection/${id}/items?start=${start}&count=${BOARD_PAGE_SIZE}`) as Record<string, unknown>;
      const raw = json?.subject_collection_items ?? json?.items;
      if (!Array.isArray(raw)) throw new Error('原站没有返回榜单内容');
      const totalValue = Number(json.total);
      const total = json.total != null && Number.isFinite(totalValue) && totalValue >= 0 ? Math.floor(totalValue) : null;
      const totalPages = total === null ? null : Math.max(1, Math.min(500, Math.ceil(total / BOARD_PAGE_SIZE)));
      const hasMore = raw.length > 0 && page < 500 && (total === null ? raw.length >= BOARD_PAGE_SIZE : start + raw.length < total);
      return { board, items: parseDomesticItems(json, board.mediaType!), page, pageSize: BOARD_PAGE_SIZE, total, totalPages, hasMore,
        ...(!raw.length && total !== null && start < total ? { notice: '原站暂未返回这一页，请重试或前往原站查看。' } : {}),
      };
    }, value => !!value && Array.isArray(value.items), null, refresh);
    if (!entry.value || !entry.at) throw new Error('暂时无法读取榜单，请稍后重试或前往原站查看');
    const stale = Date.now() - entry.at >= TTL || Date.now() < (this.retryAt.get(key) || 0);
    return { ...entry.value, fetchedAt: entry.at, stale };
  }

  genres() {
    return { movie: DOMESTIC_GENRES.movie.map((name, i) => ({ id: i + 1, name })), tv: DOMESTIC_GENRES.tv.map((name, i) => ({ id: i + 1, name })) };
  }

  async genrePage(mediaType: 'movie' | 'tv', id: number, page: number): Promise<DiscoverGenrePage> {
    const empty: DiscoverGenrePage = { items: [], page: 1, totalPages: 1 };
    const tag = DOMESTIC_GENRES[mediaType][id - 1];
    if (!tag) return empty;
    const pg = Number.isFinite(page) ? Math.max(1, Math.min(25, Math.floor(page) || 1)) : 1;
    const entry = await this.cached<DiscoverGenrePage>(`genre:${mediaType}:${id}:${pg}`, TTL, async () => {
      const j = await this.fetch(`${DOUBAN}${mediaType}/recommend?${new URLSearchParams({ start: String((pg - 1) * PAGE_SIZE), count: String(PAGE_SIZE), tags: tag })}`) as any;
      return { items: parseDomesticItems(j, mediaType), page: pg, totalPages: Math.max(pg, Math.min(25, Math.ceil((Number(j?.total) || PAGE_SIZE) / PAGE_SIZE))) };
    }, v => !!v && Array.isArray(v.items) && v.items.length > 0, empty);
    return entry.value;
  }
}

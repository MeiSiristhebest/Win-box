import { LOCAL_PROXY_BASE } from '../../shared/constants';
import type { DiscoverGenre, DiscoverGenrePage, DiscoverItem, MetaHit } from '../../shared/types';

export const DEFAULT_IMAGE_BASE = 'https://image.tmdb.org/t/p/w342';
const IMG_PROXY = `${LOCAL_PROXY_BASE}/img`;

function usable(h: Pick<MetaHit, 'poster' | 'overview'>): boolean {
  return !!(h.poster && h.poster.length > 10);
}

/**
 * 解析 TMDB search 响应 → MetaHit 候选（纯函数，供单测）。
 * json 形如 { results: [ { title|name, release_date|first_air_date, poster_path, overview } ] }。
 * poster_path 为空/不存在的条目跳过（该条目无封面可用）。
 */
export function parseTmdbSearch(json: unknown, type: 'movie' | 'tv', imageBase: string = DEFAULT_IMAGE_BASE): MetaHit[] {
  const j = json as { results?: unknown[] } | null;
  if (!j || !Array.isArray(j.results)) return [];
  const out: MetaHit[] = [];
  for (const r of j.results as Record<string, unknown>[]) {
    if (!r || typeof r !== 'object') continue;
    const posterPath = typeof r.poster_path === 'string' && r.poster_path ? r.poster_path : '';
    const backdropPath = typeof r.backdrop_path === 'string' && r.backdrop_path ? r.backdrop_path : '';
    const overview = typeof r.overview === 'string' ? r.overview : '';
    const title = String(r.title ?? r.name ?? '').trim();
    const date = String(r.release_date ?? r.first_air_date ?? '').trim();
    const year = /^(\d{4})/.exec(date)?.[1] ? Number(/^(\d{4})/.exec(date)![1]) : ('' as const);
    if (!title) continue;
    const id = Number(r.id);
    // ★ backdrop_path 必为横版剧照：详情/发现页背景只允许横版图，用它兜底（绝不退回竖版封面）
    const base = imageBase.replace(/\/+$/, '');
    const root = base.replace(/\/(?:w\d+|h\d+|original)$/i, '');
    const hit: MetaHit = {
      title,
      year: year as number | '',
      poster: posterPath ? `${base}${posterPath}` : '',
      overview,
      type,
      // ★ 2026-09-24：带出 TMDB id —— 详情页「演职员/相关推荐」用它再查一次详情
      ...(Number.isFinite(id) && id > 0 ? { tmdbId: id } : {}),
      ...(backdropPath ? { backdrop: `${root}/w1280${backdropPath}` } : {}),
    };
    if (usable(hit)) out.push(hit);
  }
  return out;
}


/** TMDB 详情（append_to_response=credits,recommendations）解析结果（原样字段，供单测） */
export interface TmdbExtrasRaw {
  genres: string[];
  cast: Array<{ name: string; character?: string }>;
  recommendations: Array<{ title: string; year: number | ''; posterPath: string; tmdbId?: number; mediaType: 'movie' | 'tv' }>;
  /** ★ 2026-09-24：导演（电影取 crew[job=Director]；剧集再并入 created_by） */
  directors: string[];
}

/**
 * 解析 `/movie/{id}?append_to_response=credits,recommendations` 响应（纯函数）。
 * genres[].name / credits.cast[].{name,character} / credits.crew[job=Director] /
 * created_by[].name（剧集）/ recommendations.results[].{title,poster_path,release_date,id}
 * 演员与导演按出现顺序去重，无封面的推荐项跳过（详情页卡片必须有图）。
 */
export function parseTmdbExtras(json: unknown, mediaType: 'movie' | 'tv'): TmdbExtrasRaw {
  const j = json as { genres?: unknown; credits?: unknown; recommendations?: unknown; created_by?: unknown } | null;
  const genres: string[] = [];
  if (Array.isArray(j?.genres)) {
    for (const g of j!.genres as Record<string, unknown>[]) {
      const n = String(g?.name ?? '').trim();
      if (n && !genres.includes(n)) genres.push(n);
    }
  }
  const directors: string[] = [];
  const pushDirector = (name: string): void => {
    const n = name.trim();
    if (n && !directors.includes(n)) directors.push(n);
  };
  const crewRaw = (j?.credits as { crew?: unknown } | undefined)?.crew;
  if (Array.isArray(crewRaw)) {
    for (const c of crewRaw as Record<string, unknown>[]) {
      if (String(c?.job ?? '').trim() !== 'Director') continue;
      pushDirector(String(c?.name ?? ''));
    }
  }
  // 剧集的「导演」在 TMDB 里通常记在 created_by（创作者）上
  if (Array.isArray(j?.created_by)) {
    for (const c of j!.created_by as Record<string, unknown>[]) pushDirector(String(c?.name ?? ''));
  }
  const cast: TmdbExtrasRaw['cast'] = [];
  const castRaw = (j?.credits as { cast?: unknown } | undefined)?.cast;
  if (Array.isArray(castRaw)) {
    for (const c of castRaw as Record<string, unknown>[]) {
      const name = String(c?.name ?? '').trim();
      if (!name || cast.some((x) => x.name === name)) continue;
      const character = String(c?.character ?? '').trim();
      cast.push(character ? { name, character } : { name });
    }
  }
  const recommendations: TmdbExtrasRaw['recommendations'] = [];
  const recRaw = (j?.recommendations as { results?: unknown } | undefined)?.results;
  if (Array.isArray(recRaw)) {
    for (const r of recRaw as Record<string, unknown>[]) {
      const title = String(r?.title ?? r?.name ?? '').trim();
      const posterPath = typeof r?.poster_path === 'string' ? r.poster_path : '';
      if (!title || !posterPath) continue;
      const date = String(r?.release_date ?? r?.first_air_date ?? '').trim();
      const y = /^(\d{4})/.exec(date)?.[1];
      const id = Number(r?.id);
      recommendations.push({
        title,
        year: y ? Number(y) : ('' as const),
        posterPath,
        mediaType,
        ...(Number.isFinite(id) && id > 0 ? { tmdbId: id } : {}),
      });
    }
  }
  return { genres, cast, recommendations, directors };
}

/**
 * 详情页增强查询：TMDB 搜索（拿 id）→ 详情（append credits/recommendations）→ MetaExtra。
 * - 无内置凭据 / 无 TMDB 命中 → null（渲染层用详情自带 actor 串兜底，不报错）；
 * - 命中条目来自旧缓存（无 tmdbId）→ forceFresh 重查一次拿 id；
 * - 内存缓存 24h（详情页来回切换不重复请求）。
 */

/**
 * ★ 2026-09-24：发现页 Hero「横版剧照轮播」用的图片集。
 *   - backdrops：`/movie|tv/{id}/images` 的横版剧照（w1280），按 vote_average 降序取前 N；
 *   - posters：同接口的竖版海报（w342），备用；
 *   - 全部包装为本地 /img 中继（渲染层直连图床可能被 DNS 污染 → 图裂）。
 * 纯解析函数（可单测）：过滤无 file_path / 过窄（backdrop < 1280）的条目并排序。
 */
export function parseTmdbImages(json: unknown): { backdrops: string[]; posters: string[] } {
  const j = json as { backdrops?: unknown[]; posters?: unknown[] } | null;
  const pick = (arr: unknown, opts: { minWidth: number; max: number; landscape?: boolean }): string[] => {
    if (!Array.isArray(arr)) return [];
    const rows = (arr as Record<string, unknown>[])
      .map((r) => ({
        path: typeof r?.file_path === 'string' ? r.file_path : '',
        width: Number(r?.width) || 0,
        height: Number(r?.height) || 0,
        vote: Number(r?.vote_average) || 0,
        /** 中文优先：有中文图时排前面（Hero 上的画面更贴合中文片名） */
        zh: r?.iso_639_1 === 'zh' ? 1 : 0,
      }))
      // ★ 2026-09-25：backdrops 里混有**竖版**图（用户上传时标错类型）→ 只看宽度会把竖图选成
      //   Hero/详情背景，铺满一个横向区域时被裁得只剩中间一条（用户报「竖版图被裁剪」）。
      //   故横版用途（landscape）必须同时满足 宽/高 ≥ 1.3。
      .filter(
        (r) =>
          r.path &&
          r.width >= opts.minWidth &&
          (!opts.landscape || (r.height > 0 && r.width / r.height >= 1.3)),
      );
    rows.sort((a, b) => b.zh - a.zh || b.vote - a.vote || b.width - a.width);
    return rows.slice(0, opts.max).map((r) => r.path);
  };
  return {
    backdrops: pick(j?.backdrops, { minWidth: 1280, max: MAX_HERO_BACKDROPS, landscape: true }),
    posters: pick(j?.posters, { minWidth: 0, max: MAX_HERO_POSTERS }),
  };
}

const MAX_HERO_BACKDROPS = 6;
const MAX_HERO_POSTERS = 8;

/** TMDB 列表项 → 发现页条目（封面包装为本地 /img 中继，渲染层直连图床可能被 DNS 污染） */
export function toDiscoverItems(json: unknown, mediaType: 'movie' | 'tv'): DiscoverItem[] {
  return parseTmdbSearch(json, mediaType).map((h) => ({
    title: h.title,
    year: h.year,
    tmdbId: h.tmdbId,
    mediaType,
    poster: h.poster ? `${IMG_PROXY}?u=${encodeURIComponent(h.poster)}` : '',
    // ★ 横版剧照（Hero 背景只用横版图，见 DiscoverPage）——同样走本地中继
    ...(h.backdrop ? { backdrop: `${IMG_PROXY}?u=${encodeURIComponent(h.backdrop)}` } : {}),
  })).filter((it) => it.poster);
}


/** 解析 `/genre/{type}/list` 响应（纯函数）：{ genres: [{ id, name }] } */
export function parseGenreList(json: unknown): DiscoverGenre[] {
  const j = json as { genres?: unknown } | null;
  if (!Array.isArray(j?.genres)) return [];
  const out: DiscoverGenre[] = [];
  for (const g of j!.genres as Record<string, unknown>[]) {
    const id = Number(g?.id);
    const name = String(g?.name ?? '').trim();
    if (Number.isFinite(id) && id > 0 && name) out.push({ id, name });
  }
  return out;
}

/** 解析 `/discover/{type}` 响应（纯函数）：条目 + 分页信息 */
export function parseGenrePage(json: unknown, mediaType: 'movie' | 'tv'): DiscoverGenrePage {
  const j = json as { page?: unknown; total_pages?: unknown } | null;
  const page = Number(j?.page);
  const totalPages = Number(j?.total_pages);
  return {
    items: toDiscoverItems(json, mediaType),
    page: Number.isFinite(page) && page > 0 ? page : 1,
    totalPages: Number.isFinite(totalPages) && totalPages > 0 ? Math.min(totalPages, 500) : 1, // TMDB 上限 500 页
  };
}


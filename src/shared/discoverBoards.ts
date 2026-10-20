import type { DiscoverItem } from './types';

export type DiscoverBoardCategory = 'movie' | 'tv' | 'variety' | 'animation' | 'documentary';
export const BOARD_CATEGORIES: ReadonlyArray<{ id: DiscoverBoardCategory; label: string }> = [
  { id: 'movie', label: '电影' }, { id: 'tv', label: '剧集' }, { id: 'variety', label: '综艺' },
  { id: 'animation', label: '动漫' }, { id: 'documentary', label: '纪录片' },
];
export interface DiscoverBoard {
  id: string;
  title: string;
  provider: 'douban' | 'tmdb' | 'plugin';
  description: string;
  externalUrl?: string;
  mediaType?: 'movie' | 'tv';
  category?: DiscoverBoardCategory;
}

export const DOMESTIC_BOARDS: readonly DiscoverBoard[] = [
  {
    "id": "movie_hot_gaia",
    "title": "豆瓣热门电影",
    "provider": "douban",
    "mediaType": "movie",
    "category": "movie",
    "description": "按豆瓣当前热门顺序浏览电影。",
    "externalUrl": "https://m.douban.com/subject_collection/movie_hot_gaia"
  },
  {
    "id": "movie_showing",
    "title": "院线正在上映",
    "provider": "douban",
    "mediaType": "movie",
    "category": "movie",
    "description": "查看豆瓣收录的当前院线上映电影。",
    "externalUrl": "https://m.douban.com/subject_collection/movie_showing"
  },
  {
    "id": "movie_soon",
    "title": "院线即将上映",
    "provider": "douban",
    "mediaType": "movie",
    "category": "movie",
    "description": "查看豆瓣收录的院线待映电影。",
    "externalUrl": "https://m.douban.com/subject_collection/movie_soon"
  },
  {
    "id": "movie_weekly_best",
    "title": "一周口碑电影榜",
    "provider": "douban",
    "mediaType": "movie",
    "category": "movie",
    "description": "浏览豆瓣一周口碑电影榜。",
    "externalUrl": "https://m.douban.com/subject_collection/movie_weekly_best"
  },
  {
    "id": "movie_top250",
    "title": "豆瓣电影 Top250",
    "provider": "douban",
    "mediaType": "movie",
    "category": "movie",
    "description": "按原站排名浏览 Top250，查看评分并搜索片源。",
    "externalUrl": "https://movie.douban.com/top250"
  },
  {
    "id": "tv_hot",
    "title": "豆瓣热门剧集",
    "provider": "douban",
    "mediaType": "tv",
    "category": "tv",
    "description": "按豆瓣当前热门顺序浏览剧集。",
    "externalUrl": "https://m.douban.com/subject_collection/tv_hot"
  },
  {
    "id": "tv_domestic",
    "title": "近期热门国产剧",
    "provider": "douban",
    "mediaType": "tv",
    "category": "tv",
    "description": "浏览豆瓣近期热门国产剧列表。",
    "externalUrl": "https://m.douban.com/subject_collection/tv_domestic"
  },
  {
    "id": "tv_american",
    "title": "近期热门美剧",
    "provider": "douban",
    "mediaType": "tv",
    "category": "tv",
    "description": "浏览豆瓣近期热门美剧列表。",
    "externalUrl": "https://m.douban.com/subject_collection/tv_american"
  },
  {
    "id": "tv_korean",
    "title": "近期热门韩剧",
    "provider": "douban",
    "mediaType": "tv",
    "category": "tv",
    "description": "浏览豆瓣近期热门韩剧列表。",
    "externalUrl": "https://m.douban.com/subject_collection/tv_korean"
  },
  {
    "id": "tv_japanese",
    "title": "近期热门日剧",
    "provider": "douban",
    "mediaType": "tv",
    "category": "tv",
    "description": "浏览豆瓣近期热门日剧列表。",
    "externalUrl": "https://m.douban.com/subject_collection/tv_japanese"
  },
  {
    "id": "tv_chinese_best_weekly",
    "title": "华语剧集口碑榜",
    "provider": "douban",
    "mediaType": "tv",
    "category": "tv",
    "description": "查看本周华语剧集口碑榜。",
    "externalUrl": "https://m.douban.com/subject_collection/tv_chinese_best_weekly"
  },
  {
    "id": "tv_global_best_weekly",
    "title": "全球剧集口碑榜",
    "provider": "douban",
    "mediaType": "tv",
    "category": "tv",
    "description": "查看本周全球剧集口碑榜。",
    "externalUrl": "https://m.douban.com/subject_collection/tv_global_best_weekly"
  },
  {
    "id": "tv_variety_show",
    "title": "近期热门综艺",
    "provider": "douban",
    "mediaType": "tv",
    "category": "variety",
    "description": "浏览豆瓣近期热门综艺节目。",
    "externalUrl": "https://m.douban.com/subject_collection/tv_variety_show"
  },
  {
    "id": "tv_animation",
    "title": "近期热门动漫",
    "provider": "douban",
    "mediaType": "tv",
    "category": "animation",
    "description": "浏览豆瓣近期热门动画剧集。",
    "externalUrl": "https://m.douban.com/subject_collection/tv_animation"
  },
  {
    "id": "tv_documentary",
    "title": "近期热门纪录片",
    "provider": "douban",
    "mediaType": "tv",
    "category": "documentary",
    "description": "浏览豆瓣近期热门纪录剧集。",
    "externalUrl": "https://m.douban.com/subject_collection/tv_documentary"
  }
];

export const TMDB_BOARDS: readonly DiscoverBoard[] = [
  {
    "id": "movie-popular",
    "title": "热门电影",
    "provider": "tmdb",
    "mediaType": "movie",
    "category": "movie",
    "description": "按 TMDB 热度浏览电影。",
    "externalUrl": "https://www.themoviedb.org/movie"
  },
  {
    "id": "movie-now-playing",
    "title": "院线正在上映",
    "provider": "tmdb",
    "mediaType": "movie",
    "category": "movie",
    "description": "浏览 TMDB 收录的当前院线上映电影。",
    "externalUrl": "https://www.themoviedb.org/movie/now-playing"
  },
  {
    "id": "movie-upcoming",
    "title": "即将上映",
    "provider": "tmdb",
    "mediaType": "movie",
    "category": "movie",
    "description": "浏览 TMDB 即将上映片单。",
    "externalUrl": "https://www.themoviedb.org/movie/upcoming"
  },
  {
    "id": "movie-top",
    "title": "高分电影",
    "provider": "tmdb",
    "mediaType": "movie",
    "category": "movie",
    "description": "按 TMDB 评分排序浏览电影。",
    "externalUrl": "https://www.themoviedb.org/movie/top-rated"
  },
  {
    "id": "tv-popular",
    "title": "热门剧集",
    "provider": "tmdb",
    "mediaType": "tv",
    "category": "tv",
    "description": "按 TMDB 热度浏览剧集。",
    "externalUrl": "https://www.themoviedb.org/tv"
  },
  {
    "id": "tv-top",
    "title": "高分剧集",
    "provider": "tmdb",
    "mediaType": "tv",
    "category": "tv",
    "description": "按 TMDB 评分排序浏览剧集。",
    "externalUrl": "https://www.themoviedb.org/tv/top-rated"
  },
  {
    "id": "tv-airing-today",
    "title": "今日播出剧集",
    "provider": "tmdb",
    "mediaType": "tv",
    "category": "tv",
    "description": "查看 TMDB 收录的今日播出剧集。",
    "externalUrl": "https://www.themoviedb.org/tv/airing-today"
  },
  {
    "id": "tv-on-the-air",
    "title": "七日内播出剧集",
    "provider": "tmdb",
    "mediaType": "tv",
    "category": "tv",
    "description": "查看 TMDB 收录的未来七日内播出剧集。",
    "externalUrl": "https://www.themoviedb.org/tv/on-the-air"
  }
];

/** Keep the homepage summary small; additional lists are requested when opened. */
export const HOME_BOARD_IDS = ['movie_hot_gaia', 'movie_showing', 'movie_top250', 'tv_hot', 'tv_chinese_best_weekly'] as const;

export function discoverBoardById(id: string): DiscoverBoard | undefined {
  return [...DOMESTIC_BOARDS, ...TMDB_BOARDS].find(board => board.id === id);
}

export function boardSourceName(board: DiscoverBoard): string {
  return board.provider === 'douban' ? '豆瓣' : board.provider === 'tmdb' ? 'TMDB' : '插件';
}

export const BOARD_PAGE_SIZE = 20;

export function normalizeBoardPage(value: unknown): number {
  const page = Number(value);
  return Number.isFinite(page) ? Math.max(1, Math.min(500, Math.floor(page))) : 1;
}

export interface DiscoverBoardPage {
  board: DiscoverBoard;
  items: DiscoverItem[];
  page: number;
  pageSize: number;
  /** 原站未提供总量时为 null。 */
  total: number | null;
  /** 仅限接口允许访问的页数；可能小于原站总量对应的页数。 */
  totalPages: number | null;
  hasMore: boolean;
  fetchedAt: number;
  stale: boolean;
  notice?: string;
}

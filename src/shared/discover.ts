// src/shared/discover.ts
// 「级联分类」的唯一权威词典与查询契约 —— 发现页与点播页共用（★ 2026-10-15 起改走豆瓣）。
//
// 为什么以豆瓣为准（实测 2026-10-15）：
//   · 豆瓣 rexxar `{movie|tv}/recommend` 自带 `recommend_categories`（类型 / 地区）与 `sorts` —— 直接当词表用，
//     **两页级联选项永远一致**，且每个值都是豆瓣认得的 tag（下发不会得到空结果）；
//   · 大陆网络直连豆瓣稳定，不需要用户配任何 Key/凭据；
//   · 年代不在豆瓣词表里，由我们补一套（实测「2026 / 2010年代 / 90年代 / 更早」均可作 tag 下发）。
//
// 点播页同用这套词：每个维度优先映射到**源的筛选组**（按组名/别名匹配），源没有时退化为本地过滤。

import type { DiscoverItem } from './types';

/** 一级「分类」（媒体类型）：剧集=电视剧，综艺=综艺（豆瓣里同属 tv，用 tag 区分） */
export type DiscoverMediaId = 'movie' | 'tv' | 'variety' | 'animation' | 'documentary';
export interface DiscoverMediaOption {
  id: DiscoverMediaId;
  name: string;
  mediaType: 'movie' | 'tv';
  /** 该分类固定携带的豆瓣 tag */
  baseTag: string;
  /** 动漫和纪录片可分别浏览电影与剧集。 */
  formats?: readonly ('movie' | 'tv')[];
}
export const DISCOVER_MEDIA: DiscoverMediaOption[] = [
  { id: 'movie', name: '电影', mediaType: 'movie', baseTag: '电影' },
  { id: 'tv', name: '剧集', mediaType: 'tv', baseTag: '电视剧' },
  { id: 'variety', name: '综艺', mediaType: 'tv', baseTag: '综艺' },
  { id: 'animation', name: '动漫', mediaType: 'tv', baseTag: '动画', formats: ['tv', 'movie'] },
  { id: 'documentary', name: '纪录片', mediaType: 'tv', baseTag: '纪录片', formats: ['tv', 'movie'] },
];

/** 「全部」文案 —— 各维度第一项统一是它 */
export const ALL_TAG = '全部';

/** 剧集细分类型（豆瓣 tv 实测可用：每个 tag 都能出结果） */
export const TV_SUBTYPES = ['美剧', '英剧', '韩剧', '日剧', '国产剧', '港剧', '日本动画', '纪录片'];
/** 电影类型 / 地区（豆瓣词表快照；运行时优先用豆瓣在线词表覆盖） */
export const MOVIE_GENRES = ['喜剧', '爱情', '动作', '科幻', '动画', '悬疑', '犯罪', '惊悚', '冒险', '音乐', '历史', '奇幻', '恐怖', '战争', '传记', '歌舞', '武侠', '灾难', '西部', '纪录片', '短片'];
export const MOVIE_REGIONS = ['华语', '欧美', '韩国', '日本', '中国大陆', '美国', '中国香港', '中国台湾', '英国', '法国', '德国', '意大利', '西班牙', '印度', '泰国', '俄罗斯', '加拿大', '澳大利亚', '爱尔兰', '瑞典', '巴西', '丹麦'];
export const TV_REGIONS = ['华语', '欧美', '国外', '韩国', '日本', '中国大陆', '中国香港', '美国', '英国', '泰国', '中国台湾', '意大利', '法国', '德国', '西班牙', '俄罗斯', '瑞典', '巴西', '丹麦', '印度', '加拿大', '爱尔兰', '澳大利亚'];

/** 维度（级联的中间层）；`key` 同时也是点播页「映射源筛选组」的匹配依据 */
export type ExploreDimensionKey = '类型' | '地区' | '年代';
export interface ExploreDimension {
  key: ExploreDimensionKey;
  label: string;
  /** 选项（首项固定为「全部」） */
  values: string[];
}
export interface ExploreSort {
  id: string;
  label: string;
}
export interface ExploreVocab {
  dimensions: ExploreDimension[];
  sorts: ExploreSort[];
  /** 默认排序 id */
  defaultSort: string;
}
export interface ExploreVocabulary {
  movie: ExploreVocab;
  tv: ExploreVocab;
  /** 词表来自在线豆瓣还是内置快照（渲染层可据此提示） */
  source: 'douban' | 'builtin';
}

/** 年代选项（豆瓣 tag 兼容：单年 / N0年代 / 更早） */
export function discoverYearValues(now: Date = new Date()): string[] {
  const y = now.getFullYear();
  const out: string[] = [ALL_TAG];
  for (let i = 0; i < 12; i++) out.push(String(y - i));
  out.push('2010年代', '2000年代', '90年代', '80年代', '更早');
  return out;
}

/** 年代 tag → 年份区间（点播页本地过滤用）；'全部' → null */
export function yearTagRange(tag: string): { from: number; to: number } | null {
  const v = (tag || '').trim();
  if (!v || v === ALL_TAG) return null;
  if (/^\d{4}$/.test(v)) return { from: Number(v), to: Number(v) };
  const m = /^(\d{4})年代$/.exec(v);
  if (m) return { from: Number(m[1]), to: Number(m[1]) + 9 };
  const m2 = /^(\d{2})年代$/.exec(v);
  if (m2) { const y = Number(m2[1]); return { from: y >= 30 ? 1900 + y : 2000 + y, to: (y >= 30 ? 1900 + y : 2000 + y) + 9 }; }
  if (v === '更早') return { from: 0, to: 1979 };
  return null;
}

/** 豆瓣排序（T 综合 / U 近期热度 / R 首映·首播时间 / S 高分优先） */
export const DOUBAN_SORTS: ExploreSort[] = [
  { id: 'T', label: '综合排序' },
  { id: 'U', label: '近期热度' },
  { id: 'R', label: '按时间' },
  { id: 'S', label: '高分优先' },
];

/** 内置兜底词表（豆瓣在线词表拉取失败时用；内容 = 2026-10-15 实测快照） */
export const BUILTIN_VOCAB: ExploreVocabulary = {
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

/** 发现页「分类浏览」查询（渲染层 → 主进程）；tags = 已选各维度的豆瓣 tag（'全部' 不下发） */
export interface ExploreQuery {
  mediaType: 'movie' | 'tv';
  tags: string[];
  sort?: string;
  /** 起始偏移（豆瓣按 start 分页，非页码） */
  start?: number;
  count?: number;
  /** 用户刷新时重新读取来源，更新可能失效的图片地址。 */
  refresh?: boolean;
}
export interface ExplorePage {
  items: DiscoverItem[];
  start: number;
  /** 原始结果的下一偏移，包含被过滤的非影片条目。 */
  nextStart?: number;
  total: number;
  hasMore: boolean;
}

// ==================== 点播页：我们自建维度的「本地过滤」口径（★ 2026-10-15） ====================
// 点播页一级仍是**源分类**；其下的 类型/地区/年代/排序 四维：
//   · 源有对应筛选组 → 用**源自己的选项**（服务端筛选，精确）；
//   · 源没有该组 → 用下面的通用词表，在**源已返回的条目**上本地过滤（数据仍来自本源，不走聚合）。

const dedupe = (list: string[]): string[] => list.filter((v, i, a) => v && a.indexOf(v) === i);

/** 点播页本地过滤的通用维度词表（与发现页同一豆瓣口径 + 剧集子类） */
export function localDimensions(): ExploreDimension[] {
  return [
    { key: '类型', label: '类型', values: [ALL_TAG, ...dedupe([...MOVIE_GENRES, ...TV_SUBTYPES])] },
    { key: '地区', label: '地区', values: [ALL_TAG, ...dedupe([...MOVIE_REGIONS, ...TV_REGIONS])] },
    { key: '年代', label: '年代', values: discoverYearValues() },
  ];
}

/** 点播页本地排序（源没有「排序」筛选组时用） */
export const LOCAL_SORTS: ExploreSort[] = [
  { id: 'default', label: '按默认' },
  { id: 'year', label: '按年份' },
  { id: 'name', label: '按片名' },
];

/** 地区别名：我们的维度值 → 源条目 `area` 里可能出现的写法 */
const REGION_ALIAS: Record<string, string[]> = {
  中国大陆: ['大陆', '中国', '内地', '国产', '华语'],
  华语: ['大陆', '中国', '内地', '香港', '台湾', '国产', '华语'],
  欧美: ['美国', '英国', '法国', '德国', '意大利', '西班牙', '俄罗斯', '加拿大', '澳大利亚', '欧美'],
  国外: [],
  美国: ['美'], 英国: ['英'], 韩国: ['韩'], 日本: ['日'], 法国: ['法'], 德国: ['德'],
  意大利: ['意'], 西班牙: ['西'], 印度: ['印'], 泰国: ['泰'], 俄罗斯: ['俄'],
  加拿大: ['加'], 澳大利亚: ['澳洲', '澳'], 中国香港: ['香港', '港'], 中国台湾: ['台湾', '台'],
};
/** 类型别名（多数情况靠「包含」就能命中，这里只补少数写法差异大的） */
const GENRE_ALIAS: Record<string, string[]> = {
  动画: ['动漫', '卡通', '日本动画'],
  科幻: ['科学幻想'],
  喜剧: ['搞笑'],
  纪录片: ['纪实'],
  日本动画: ['动漫', '卡通', '动画'],
};

const norm = (s: string): string => (s || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');

/** 单维度的本地命中判断（纯函数，供单测）：宽松「包含」匹配 + 别名；年代走年份区间 */
export function localMatch(dim: ExploreDimensionKey, value: string, field: string): boolean {
  const raw = (field || '').trim();
  if (!raw) return false;
  if (dim === '年代') {
    const range = yearTagRange(value);
    const y = Number(/\b(19|20)\d{2}\b/.exec(raw)?.[0] ?? NaN);
    return !!range && Number.isFinite(y) && y >= range.from && y <= range.to;
  }
  const f = norm(raw);
  if (!f) return false;
  const aliases = dim === '地区' ? REGION_ALIAS[value] : GENRE_ALIAS[value];
  const cands = dedupe([norm(value), ...(aliases || []).map(norm)]).filter(Boolean);
  return cands.some((c) => f === c || f.includes(c) || c.includes(f));
}

/** 条目某维度对应的字段值 */
export function fieldOfDim(it: DiscoverItem | { area?: string; year?: string; type?: string }, dim: ExploreDimensionKey): string {
  const o = it as { area?: string; year?: string; type?: string };
  return dim === '地区' ? (o.area || '') : dim === '年代' ? (o.year || '') : (o.type || '');
}

/** 本地过滤：把已选（非「全部」）的维度全部套上（纯函数，供单测） */
export function applyLocalFilters<T extends { area?: string; year?: string; type?: string }>(items: T[], sel: Record<string, string>): T[] {
  const active = Object.entries(sel).filter(([, v]) => v && v !== ALL_TAG) as Array<[ExploreDimensionKey, string]>;
  if (active.length === 0) return items;
  return items.filter((it) => active.every(([dim, v]) => localMatch(dim, v, fieldOfDim(it, dim))));
}

/** 本地排序（纯函数）：'year' 年份新→旧；'name' 片名（中文拼音序）；其余保持原序。无年份的排最后。 */
export function sortLocal<T extends { name?: string; year?: string }>(items: T[], sortId: string): T[] {
  if (sortId === 'year') {
    return [...items].sort((a, b) => {
      const ya = Number(/\b(19|20)\d{2}\b/.exec(a.year || '')?.[0] ?? 0);
      const yb = Number(/\b(19|20)\d{2}\b/.exec(b.year || '')?.[0] ?? 0);
      return yb - ya;
    });
  }
  if (sortId === 'name') {
    return [...items].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN'));
  }
  return items;
}

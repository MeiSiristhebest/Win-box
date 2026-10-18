import type { ThemeLayout, ThemeSkinView } from '../plugin';
// Theme metadata and presentation selection. Color values remain in the theme CSS files.
export type ShellPresentation = 'integrated-nav' | 'bilibili-header' | 'apple-sidebar' | 'douban-header';
export type DiscoverPresentation = 'standard-grid' | 'netflix-rows' | 'apple-rows' | 'douban-wall';
export type DetailPresentation = 'standard' | 'netflix-cinema' | 'apple-cinema' | 'douban-catalog';
export type SourceBrowsePresentation = 'standard' | 'douban';

export const SEMANTIC_TOKEN_NAMES = [
  'surface',
  'surface-raised',
  'surface-elevated',
  'text-primary',
  'text-secondary',
  'color-accent',
  'on-accent',
  'color-danger',
  'on-danger',
  'border-subtle',
  'backdrop',
  'radius-control',
  'radius-container',
] as const;

export type SemanticTokenName = typeof SEMANTIC_TOKEN_NAMES[number];

/** Values owned by the theme registry and applied to the document root. */
export type ThemeTokens = Readonly<Record<SemanticTokenName, string>>;

export interface PresentationDefinition {
  shell: ShellPresentation;
  discover: DiscoverPresentation;
  detail: DetailPresentation;
  sourceBrowse: SourceBrowsePresentation;
}

export const presentations = {
  standard: { shell: 'integrated-nav', discover: 'standard-grid', detail: 'standard', sourceBrowse: 'standard' },
  bilibili: { shell: 'bilibili-header', discover: 'standard-grid', detail: 'standard', sourceBrowse: 'standard' },
  netflix: { shell: 'integrated-nav', discover: 'netflix-rows', detail: 'netflix-cinema', sourceBrowse: 'standard' },
  apple: { shell: 'apple-sidebar', discover: 'apple-rows', detail: 'apple-cinema', sourceBrowse: 'standard' },
  douban: { shell: 'douban-header', discover: 'douban-wall', detail: 'douban-catalog', sourceBrowse: 'douban' },
} as const satisfies Record<string, PresentationDefinition>;

export type PresentationId = keyof typeof presentations;

export interface ThemeDefinition {
  label: string;
  presentation: PresentationId;
  colorScheme: 'light' | 'dark';
  tokens: ThemeTokens;
}

export const themes = {
  netflix: {
    label: '🎬 网飝', presentation: 'netflix', colorScheme: 'dark',
    tokens: {
      surface: '#000000', 'surface-raised': '#141414', 'surface-elevated': '#1f1f1f',
      'text-primary': '#ffffff', 'text-secondary': '#bcbcbc', 'color-accent': '#e50914',
      'on-accent': '#ffffff', 'color-danger': '#eb3942', 'on-danger': '#111111',
      'border-subtle': 'rgba(255, 255, 255, .09)', backdrop: '#141414',
      'radius-control': '4px', 'radius-container': '8px',
    },
  },
  bilibili: {
    label: '📺 哔哔', presentation: 'bilibili', colorScheme: 'light',
    tokens: {
      surface: '#f1f2f3', 'surface-raised': '#ffffff', 'surface-elevated': '#ffffff',
      'text-primary': '#18191c', 'text-secondary': '#61666d', 'color-accent': '#00aeec',
      'on-accent': '#08232c', 'color-danger': '#f56c6c', 'on-danger': '#111111',
      'border-subtle': 'rgba(227, 229, 231, .9)', backdrop: '#f1f2f3',
      'radius-control': '8px', 'radius-container': '12px',
    },
  },
  apple: {
    label: '🍎 大果', presentation: 'apple', colorScheme: 'light',
    tokens: {
      surface: '#f5f5f7', 'surface-raised': 'rgba(255, 255, 255, .72)', 'surface-elevated': 'rgba(255, 255, 255, .88)',
      'text-primary': '#1d1d1f', 'text-secondary': '#6e6e73', 'color-accent': '#007aff',
      'on-accent': '#00264c', 'color-danger': '#ff3b30', 'on-danger': '#111111',
      'border-subtle': 'rgba(60, 60, 67, .1)', backdrop: 'rgba(250, 250, 252, .8)',
      'radius-control': '10px', 'radius-container': '14px',
    },
  },
  douban: {
    label: '🫘 大豆', presentation: 'douban', colorScheme: 'light',
    tokens: {
      surface: '#f2f4ef', 'surface-raised': 'rgba(255, 255, 255, .86)', 'surface-elevated': '#ffffff',
      'text-primary': '#1a1d19', 'text-secondary': '#5f675d', 'color-accent': '#2e9629',
      'on-accent': '#102610', 'color-danger': '#d93025', 'on-danger': '#111111',
      'border-subtle': 'rgba(26, 32, 25, .095)', backdrop: 'rgba(252, 253, 250, .93)',
      'radius-control': '12px', 'radius-container': '20px',
    },
  },
} as Record<string, ThemeDefinition>;

export type Theme = string;
export const DEFAULT_THEME: Theme = 'netflix';
export const THEME_LABELS = Object.fromEntries(
  Object.entries(themes).map(([id, definition]) => [id, definition.label]),
) as Record<Theme, string>;

export function normalizeTheme(value: unknown): Theme {
  return findSkin(value)?.id ?? DEFAULT_THEME;
}

export function presentationFor(theme: Theme): PresentationDefinition {
  if (Object.hasOwn(themes, theme)) return presentations[themes[theme].presentation];
  const layout = skinLayout(theme);
  const shells: Record<string, ShellPresentation> = { topbar: 'integrated-nav', dualbar: 'bilibili-header', sidebar: 'apple-sidebar', pillbar: 'douban-header' };
  const discover: Record<string, DiscoverPresentation> = { shelf: 'netflix-rows', shelfWide: 'apple-rows', wall: 'douban-wall' };
  const detail: Record<string, DetailPresentation> = { cinema: 'netflix-cinema', glass: 'apple-cinema', poster: 'douban-catalog' };
  return { shell: shells[layout.shell ?? 'topbar'] ?? 'integrated-nav', discover: discover[layout.discoverStyle ?? 'basic'] ?? 'standard-grid', detail: detail[layout.detailStyle ?? 'basic'] ?? 'standard', sourceBrowse: layout.filterStyle === 'card' ? 'douban' : 'standard' };
}

export function colorSchemeFor(theme: Theme): 'light' | 'dark' {
  return skinBase(theme);
}

export interface SkinEntry {
  /** 直接用作 `data-theme` 的生效值 */
  id: string;
  label: string;
  kind: 'builtin' | 'plugin';
  /** 原生窗口底色（主进程 nativeTheme 对齐用） */
  base: 'dark' | 'light';
  /** 结构声明（组件据此选外壳/排版，不再按皮肤 id 分支） */
  layout: ThemeLayout;
  /** **仅插件皮肤**：令牌 → 值；内置皮肤的令牌写在各自 CSS 文件里 */
  tokens?: Record<string, string>;
}

/**
 * 四套内置皮肤的结构声明（2026-10-18 定稿，勿改）：
 *   netflix = 单行顶栏 + 影院式详情 + 内容行；bilibili = 双行头；apple = 玻璃侧边栏 + 玻璃详情 + 宽内容行；
 *   douban = 胶囊导航 + 左海报右信息详情 + 海报墙 + 卡片筛选条。
 */
const BUILTIN_SKINS: SkinEntry[] = [
  {
    id: 'netflix', label: THEME_LABELS.netflix, kind: 'builtin', base: 'dark',
    layout: { shell: 'topbar', detailStyle: 'cinema', discoverStyle: 'shelf', navHeight: 58, cardWidth: 176 },
  },
  {
    id: 'bilibili', label: THEME_LABELS.bilibili, kind: 'builtin', base: 'light',
    layout: { shell: 'dualbar' },
  },
  {
    id: 'apple', label: THEME_LABELS.apple, kind: 'builtin', base: 'light',
    layout: { shell: 'sidebar', detailStyle: 'glass', discoverStyle: 'shelfWide', navHeight: 52, sideWidth: 212 },
  },
  {
    id: 'douban', label: THEME_LABELS.douban, kind: 'builtin', base: 'light',
    layout: { shell: 'pillbar', detailStyle: 'poster', discoverStyle: 'wall', filterStyle: 'card' },
  },
];

/** 插件皮肤（宿主在启动时载入；卸载后自动从表里消失） */
let pluginSkins: SkinEntry[] = [];

/** 合并后的 `layout` 缓存（同一 id 返回**同一对象**，便于组件把它当稳定引用用于依赖数组） */
const layoutCache = new Map<string, ThemeLayout>();

/** 全部皮肤（内置在前，插件在后）—— 设置页遍历它渲染切换项 */
export function allSkins(): SkinEntry[] {
  return [...BUILTIN_SKINS, ...pluginSkins];
}

/** 按 id 取皮肤（未知 id → undefined） */
export function findSkin(id: unknown): SkinEntry | undefined {
  if (typeof id !== 'string' || !id) return undefined;
  return BUILTIN_SKINS.find((s) => s.id === id) ?? pluginSkins.find((s) => s.id === id);
}

/**
 * 载入插件皮肤注册表（宿主 `plugins.themes()` 的结果）。
 * 每次全量替换（重复 id 以先出现者为准），并清掉 layout 缓存。
 */
export function registerPluginSkins(list: ThemeSkinView[] | undefined): void {
  const seen = new Set<string>();
  const next: SkinEntry[] = [];
  for (const s of list ?? []) {
    if (!s || typeof s.id !== 'string' || !/^plugin:[a-z0-9-]{3,40}$/.test(s.id) || seen.has(s.id)) continue;
    if (!s.tokens || typeof s.tokens !== 'object') continue;
    seen.add(s.id);
    next.push({
      id: s.id,
      label: s.label || s.id,
      kind: 'plugin',
      base: s.base === 'light' ? 'light' : 'dark',
      layout: s.layout || {},
      tokens: s.tokens,
    });
  }
  pluginSkins = next;
  layoutCache.clear();
}

/**
 * 任意值 → 合法皮肤 id（未知 / 空 / 旧值 / 已被卸载的插件皮肤 → 默认皮肤网飝）。
 * 注意：插件皮肤在**注册表载入之前**会先落到默认皮肤，载入后由 initTheme 还原真实意图。
 */


/** 皮肤的**结构声明**（未声明的字段回落缺省：单行顶栏 + 朴素筛选条） */
export function skinLayout(id: unknown): ThemeLayout {
  const key = normalizeTheme(id);
  const hit = layoutCache.get(key);
  if (hit) return hit;
  const merged: ThemeLayout = { shell: 'topbar', filterStyle: 'plain', ...findSkin(key)?.layout };
  layoutCache.set(key, merged);
  return merged;
}

/** 皮肤的原生底色（主进程 nativeTheme 对齐用） */
export function skinBase(id: unknown): 'dark' | 'light' {
  return findSkin(normalizeTheme(id))?.base === 'light' ? 'light' : 'dark';
}

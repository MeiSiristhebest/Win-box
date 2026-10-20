import type { ThemeLayout, ThemeSkinView } from '../plugin';
// Theme metadata, semantic colors, and presentation selection.
export type ShellPresentation = 'desktop' | 'integrated-nav' | 'bilibili-header' | 'apple-sidebar' | 'douban-header';
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
  desktop: { shell: 'desktop', discover: 'standard-grid', detail: 'standard', sourceBrowse: 'standard' },
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
  dark: {
    label: '深色', presentation: 'desktop', colorScheme: 'dark',
    tokens: {
      surface: '#111317', 'surface-raised': '#191c22', 'surface-elevated': '#242830',
      'text-primary': '#edf0f6', 'text-secondary': '#a4acba', 'color-accent': '#9ab7ff',
      'on-accent': '#132341', 'color-danger': '#ff8c91', 'on-danger': '#321114',
      'border-subtle': '#292e38', backdrop: '#191c22',
      'radius-control': '9px', 'radius-container': '14px',
    },
  },
  light: {
    label: '浅色', presentation: 'desktop', colorScheme: 'light',
    tokens: {
      surface: '#f7f8fa', 'surface-raised': '#ffffff', 'surface-elevated': '#ffffff',
      'text-primary': '#25282f', 'text-secondary': '#606065', 'color-accent': '#355fd6',
      'on-accent': '#ffffff', 'color-danger': '#b8313b', 'on-danger': '#ffffff',
      'border-subtle': '#dfe2e8', backdrop: '#ffffff',
      'radius-control': '9px', 'radius-container': '14px',
    },
  },
} as Record<string, ThemeDefinition>;

export type Theme = string;
export const DEFAULT_THEME: Theme = 'dark';
const LEGACY_THEME_IDS: Readonly<Record<string, string>> = { netflix: 'dark', bilibili: 'light', apple: 'light', douban: 'light' };
export const THEME_LABELS = Object.fromEntries(
  Object.entries(themes).map(([id, definition]) => [id, definition.label]),
) as Record<Theme, string>;

export function normalizeTheme(value: unknown): Theme {
  return findSkin(value)?.id ?? DEFAULT_THEME;
}

export function presentationFor(theme: Theme): PresentationDefinition {
  const known = findSkin(theme);
  if (known?.kind === 'builtin') return presentations[themes[known.id].presentation];
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

/** 内置外观共用桌面布局；插件可继续声明自己的展示结构。 */
const BUILTIN_SKINS: SkinEntry[] = [
  {
    id: 'dark', label: THEME_LABELS.dark, kind: 'builtin', base: 'dark',
    layout: { shell: 'topbar', navHeight: 58, cardWidth: 156 },
  },
  {
    id: 'light', label: THEME_LABELS.light, kind: 'builtin', base: 'light',
    layout: { shell: 'topbar', navHeight: 58, cardWidth: 156 },
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
  const key = Object.hasOwn(LEGACY_THEME_IDS, id) ? LEGACY_THEME_IDS[id] : id;
  return BUILTIN_SKINS.find((s) => s.id === key) ?? pluginSkins.find((s) => s.id === key);
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
 * 任意值 → 合法外观 id；旧内置名称迁移到浅色或深色。
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

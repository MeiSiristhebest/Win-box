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
} as const satisfies Record<string, ThemeDefinition>;

export type Theme = keyof typeof themes;
export const DEFAULT_THEME: Theme = 'netflix';
export const THEME_LABELS = Object.fromEntries(
  Object.entries(themes).map(([id, definition]) => [id, definition.label]),
) as Record<Theme, string>;

export function normalizeTheme(value: unknown): Theme {
  return typeof value === 'string' && Object.hasOwn(themes, value) ? value as Theme : DEFAULT_THEME;
}

export function presentationFor(theme: Theme): PresentationDefinition {
  return presentations[themes[theme].presentation];
}

export function colorSchemeFor(theme: Theme): 'light' | 'dark' {
  return themes[theme].colorScheme;
}

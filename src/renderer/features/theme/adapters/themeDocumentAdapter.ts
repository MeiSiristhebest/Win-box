import { normalizeTheme, SEMANTIC_TOKEN_NAMES, skinBase, skinLayout, themes, type SkinEntry, type Theme } from '../../../lib/themeTokens';
import type { ThemeLayout, ThemeSkinView } from '../../../../shared/plugin';
import type { ThemeDocumentPort } from '../application/themeApplication';

const STYLE_ID = 'winbox-plugin-themes';
const UNSAFE_VALUE = /[;{}<>]|url\s*\(|expression\s*\(|@import|\/\*/i;
const SAFE_NAME = /^--[a-z0-9-]+$/i;
const pluginAliases = {
  surface: 'var(--surface-0)',
  'surface-raised': 'var(--surface-2)',
  'surface-elevated': 'var(--surface-3)',
  'text-primary': 'var(--text)',
  'text-secondary': 'var(--text-dim)',
  'color-accent': 'var(--accent)',
  'on-accent': 'var(--text)',
  'color-danger': 'var(--danger)',
  'on-danger': '#111111',
  'border-subtle': 'var(--border-soft)',
  backdrop: 'var(--surface-glass)',
  'radius-control': 'var(--radius-sm)',
  'radius-container': 'var(--radius)',
};

function applyLayoutVars(root: HTMLElement, layout: ThemeLayout): void {
  const set = (name: string, px?: number): void => {
    if (typeof px === 'number' && Number.isFinite(px)) root.style.setProperty(name, `${px}px`);
    else root.style.removeProperty(name);
  };
  set('--nav-h', layout.navHeight);
  set('--side-w', layout.sideWidth);
  set('--card-w', layout.cardWidth);
}

function applyRadiusScale(root: HTMLElement, scale?: number): void {
  const keys = ['--radius', '--radius-sm', '--radius-lg'];
  for (const key of keys) root.style.removeProperty(key);
  if (typeof scale !== 'number' || scale === 1) return;

  const computed = root.ownerDocument.defaultView?.getComputedStyle(root);
  if (!computed) return;
  for (const key of keys) {
    const base = parseFloat(computed.getPropertyValue(key));
    if (Number.isFinite(base) && base > 0) root.style.setProperty(key, `${(base * scale).toFixed(2)}px`);
  }
}

function pluginSkinCss(skins: SkinEntry[]): string {
  return skins
    .filter((skin) => skin.kind === 'plugin' && skin.tokens)
    .map((skin) => {
      const declarations = Object.entries(skin.tokens as Record<string, string>)
        .filter(([name, value]) => SAFE_NAME.test(name) && typeof value === 'string' && value.trim() !== '' && !UNSAFE_VALUE.test(value))
        .map(([name, value]) => `${name}:${value.trim()}`)
        .join(';');
      return declarations ? `:root[data-theme="${skin.id}"]{${declarations}}` : '';
    })
    .filter(Boolean)
    .join('\n');
}

export function createThemeDocumentAdapter(doc: Document): ThemeDocumentPort {
  function apply(theme: Theme): void {
    const root = doc.documentElement;
    const layout = skinLayout(theme);
    root.setAttribute('data-theme', theme);
    root.setAttribute('data-ui', theme === 'light' || theme === 'dark' ? 'desktop' : 'plugin');
    root.setAttribute('data-base', skinBase(theme));
    root.style.colorScheme = skinBase(theme);
    root.setAttribute('data-shell', layout.shell ?? 'topbar');
    root.setAttribute('data-detail', layout.detailStyle ?? 'basic');
    root.setAttribute('data-discover', layout.discoverStyle ?? 'basic');
    root.setAttribute('data-filter', layout.filterStyle ?? 'plain');
    const tokens = Object.hasOwn(themes, theme) ? themes[theme].tokens : pluginAliases;
    for (const name of SEMANTIC_TOKEN_NAMES) {
      if (theme.startsWith('plugin:') && name === 'on-accent') root.style.removeProperty('--on-accent');
      else root.style.setProperty('--' + name, tokens[name]);
    }
    applyLayoutVars(root, layout);
    applyRadiusScale(root, layout.radiusScale);
  }

  function installPluginStyles(skins: SkinEntry[]): void {
    const head = doc.head;
    if (!head) return;
    let style = doc.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
      style = doc.createElement('style');
      style.id = STYLE_ID;
      head.appendChild(style);
    }
    style.textContent = pluginSkinCss(skins);
  }

  return {
    currentTheme: () => {
      const value = doc.documentElement.getAttribute('data-theme');
      return normalizeTheme(value);
    },
    apply,
    installPluginStyles,
  };
}

export const themeDocumentAdapter = createThemeDocumentAdapter(document);

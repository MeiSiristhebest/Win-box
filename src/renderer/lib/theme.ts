import { useSyncExternalStore } from 'react';
import { client } from '../api/client';
import { readPreference, subscribePreference, writePreference } from './preferenceStore';
import { DEFAULT_THEME, allSkins, normalizeTheme, registerPluginSkins, skinBase, skinLayout, themes, SEMANTIC_TOKEN_NAMES, type Theme } from './themeTokens';
import type { ThemeLayout } from '../../shared/plugin';

export type { Theme };
const KEY = 'winbox-theme';
const STYLE_ID = 'winbox-plugin-themes';
const UNSAFE_VALUE = /[;{}<>]|url\s*\(|expression\s*\(|@import|\/\*/i;
const SAFE_NAME = /^--[a-z0-9-]+$/i;
export const THEME_EVENT = 'winbox:theme-changed';
export const THEMES_EVENT = 'winbox:themes-changed';
let registryRevision = 0;
let registryRequest = 0;
const pluginAliases = { surface: 'var(--surface-0)', 'surface-raised': 'var(--surface-2)', 'surface-elevated': 'var(--surface-3)', 'text-primary': 'var(--text)', 'text-secondary': 'var(--text-dim)', 'color-accent': 'var(--accent)', 'on-accent': 'var(--text)', 'color-danger': 'var(--danger)', 'on-danger': '#111111', 'border-subtle': 'var(--border-soft)', backdrop: 'var(--surface-glass)', 'radius-control': 'var(--radius-sm)', 'radius-container': 'var(--radius)' };

function applyLayoutVars(layout: ThemeLayout): void {
  const root = document.documentElement;
  const set = (name: string, px?: number): void => {
    if (typeof px === 'number' && Number.isFinite(px)) root.style.setProperty(name, `${px}px`);
    else root.style.removeProperty(name);
  };
  set('--nav-h', layout.navHeight);
  set('--side-w', layout.sideWidth);
  set('--card-w', layout.cardWidth);
}

/** `layout.radiusScale`：按倍率放大皮肤声明的三个圆角令牌（无声明 = 不动） */
function applyRadiusScale(scale?: number): void {
  const root = document.documentElement;
  const KEYS = ['--radius', '--radius-sm', '--radius-lg'];
  // 先清掉上一轮的内联倍率，让皮肤令牌重新生效（皮肤切换时会换一套值）
  for (const k of KEYS) root.style.removeProperty(k);
  if (typeof scale !== 'number' || scale === 1) return;
  const cs = getComputedStyle(root);
  for (const k of KEYS) {
    const base = parseFloat(cs.getPropertyValue(k));
    if (Number.isFinite(base) && base > 0) root.style.setProperty(k, `${(base * scale).toFixed(2)}px`);
  }
}



export function currentTheme(): Theme { return normalizeTheme(document.documentElement.getAttribute('data-theme')); }

function applyThemeToDocument(theme: Theme): void {
  const root = document.documentElement;
  const layout = skinLayout(theme);
  root.setAttribute('data-theme', theme);
  root.setAttribute('data-base', skinBase(theme));
  root.setAttribute('data-shell', layout.shell ?? 'topbar');
  root.setAttribute('data-detail', layout.detailStyle ?? 'basic');
  root.setAttribute('data-discover', layout.discoverStyle ?? 'basic');
  root.setAttribute('data-filter', layout.filterStyle ?? 'plain');
  const tokens = Object.hasOwn(themes, theme) ? themes[theme].tokens : pluginAliases;
  for (const name of SEMANTIC_TOKEN_NAMES) {
    // The plugin owns this token directly; an alias would overwrite it with a different value.
    if (theme.startsWith('plugin:') && name === 'on-accent') root.style.removeProperty('--on-accent');
    else root.style.setProperty('--' + name, tokens[name]);
  }
  applyLayoutVars(layout);
  applyRadiusScale(layout.radiusScale);
}

export function applyTheme(value: Theme): void {
  const theme = normalizeTheme(value);
  applyThemeToDocument(theme);
  writePreference(KEY, theme);
  window.dispatchEvent(new Event(THEME_EVENT));
}

function injectPluginSkinCss(): void {
  const css = allSkins()
    .filter((s) => s.kind === 'plugin' && s.tokens)
    .map((s) => {
      const decls = Object.entries(s.tokens as Record<string, string>)
        .filter(([k, v]) => SAFE_NAME.test(k) && typeof v === 'string' && v.trim() !== '' && !UNSAFE_VALUE.test(v))
        .map(([k, v]) => `${k}:${v.trim()}`)
        .join(';');
      // id 形如 `plugin:<skinId>`，skinId 已被契约校验为 [a-z0-9-]{3,40} → 放进属性选择器安全
      return decls ? `:root[data-theme="${s.id}"]{${decls}}` : '';
    })
    .filter(Boolean)
    .join('\n');
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = css;
}



export async function loadSkinRegistry(): Promise<void> {
  const request = ++registryRequest;
  let ready = false;
  try {
    const skins = await client.pluginThemes();
    if (request !== registryRequest) return;
    registerPluginSkins(skins);
    ready = true;
  } catch { if (request !== registryRequest) return; }
  injectPluginSkinCss();
  const raw = readPreference(KEY);
  const theme = normalizeTheme(raw);
  applyThemeToDocument(theme);
  if (ready && raw && raw !== theme) writePreference(KEY, theme);
  registryRevision += 1;
  window.dispatchEvent(new Event(THEMES_EVENT));
}

export function initTheme(): Theme {
  applyThemeToDocument(normalizeTheme(readPreference(KEY)));
  void loadSkinRegistry();
  return currentTheme();
}

function subscribeTheme(notify: () => void): () => void {
  const changed = () => notify();
  const off = subscribePreference(KEY, () => { applyThemeToDocument(normalizeTheme(readPreference(KEY))); notify(); });
  window.addEventListener(THEME_EVENT, changed);
  window.addEventListener(THEMES_EVENT, changed);
  return () => { off(); window.removeEventListener(THEME_EVENT, changed); window.removeEventListener(THEMES_EVENT, changed); };
}
type ThemeSnapshot = {
  key: string;
  theme: Theme;
  layout: ThemeLayout;
  skins: ReturnType<typeof allSkins>;
};
let cachedSnapshot: ThemeSnapshot | undefined;
const serverSnapshot: ThemeSnapshot = { key: DEFAULT_THEME + ':0', theme: DEFAULT_THEME, layout: skinLayout(DEFAULT_THEME), skins: allSkins() };
const snapshot = (): ThemeSnapshot => {
  const theme = currentTheme();
  const key = theme + ':' + registryRevision;
  if (cachedSnapshot?.key !== key) cachedSnapshot = { key, theme, layout: skinLayout(theme), skins: allSkins() };
  return cachedSnapshot;
};
const getServerSnapshot = () => serverSnapshot;
export function useTheme(): Theme {
  return useSyncExternalStore(subscribeTheme, snapshot, getServerSnapshot).theme;
}
export function useSkinLayout(): ThemeLayout { return useSyncExternalStore(subscribeTheme, snapshot, getServerSnapshot).layout; }
export function useSkins() { return useSyncExternalStore(subscribeTheme, snapshot, getServerSnapshot).skins; }

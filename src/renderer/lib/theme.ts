// src/renderer/lib/theme.ts
// 主题定义和语义令牌由 themeTokens.ts 集中登记。
// 选择由主进程偏好服务持久化，并同步到 `<html data-theme>`，驱动主题 CSS 变量。
import { useSyncExternalStore } from 'react';
import { readPreference, subscribePreference, writePreference } from './preferenceStore';
import { DEFAULT_THEME, normalizeTheme, SEMANTIC_TOKEN_NAMES, themes, type Theme } from './themeTokens';

export type { Theme };
const KEY = 'winbox-theme';

function applyThemeTokens(theme: Theme): void {
  const root = document.documentElement;
  const tokens = themes[theme].tokens;
  for (const name of SEMANTIC_TOKEN_NAMES) root.style.setProperty(`--${name}`, tokens[name]);
}

/** 当前皮肤（从 DOM 读取，本地持久化后的最终生效值）。 */
export function currentTheme(): Theme {
  return normalizeTheme(document.documentElement.getAttribute('data-theme'));
}

function applyThemeToDocument(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  applyThemeTokens(theme);
}

/** 应用主题并将新选择持久化到主进程拥有的偏好服务。 */
export function applyTheme(t: Theme): void {
  const theme = normalizeTheme(t);
  applyThemeToDocument(theme);
  writePreference(KEY, theme);
}

/** 初始化：读持久化偏好并应用（在 React 挂载前调用，避免白屏闪烁）。 */
export function initTheme(): Theme {
  const t = normalizeTheme(readPreference(KEY));
  applyThemeToDocument(t);
  return t;
}

function syncThemeFromPreference(): Theme {
  const theme = normalizeTheme(readPreference(KEY));
  applyThemeTokens(theme);
  if (currentTheme() !== theme) {
    document.documentElement.setAttribute('data-theme', theme);
  }
  return theme;
}

const subscribeTheme = (notify: () => void): (() => void) =>
  subscribePreference(KEY, () => { syncThemeFromPreference(); notify(); });

/** Electron windows receive main-process snapshots; browser preview uses storage events. */
export function useTheme(): Theme {
  return useSyncExternalStore(
    subscribeTheme,
    currentTheme,
    () => DEFAULT_THEME,
  );
}

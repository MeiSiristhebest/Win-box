import { DEFAULT_THEME, themes, type Theme } from './ui/themeTokens';

export type UiThemeId = Theme;
export const UI_THEME_IDS: readonly UiThemeId[] = Object.freeze(Object.keys(themes) as UiThemeId[]);

export type MotionPreference = 'auto' | 'on' | 'off';

export interface UiPreferences {
  themeId: UiThemeId;
  motion: MotionPreference;
  showDiscover: boolean;
  waterfall: boolean;
  /** Optional when reading snapshots written before navigation preferences were added. */
  homeFilters?: boolean;
  navMode?: 'inline' | 'window';
}

export interface UiPreferencesSnapshot {
  revision: number;
  initialized: boolean;
  values: UiPreferences;
}

export type UiPreferencesPatch = Partial<UiPreferences>;

export const DEFAULT_UI_PREFERENCES: Readonly<UiPreferences> = Object.freeze({
  themeId: DEFAULT_THEME,
  motion: 'auto',
  showDiscover: true,
  waterfall: false,
  homeFilters: false,
  navMode: 'inline',
});

const THEME_IDS = new Set<string>(UI_THEME_IDS);

export function validateUiPreferencesPatch(value: unknown): UiPreferencesPatch {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('界面偏好更新必须是对象');
  }
  const patch = value as Record<string, unknown>;
  const next: UiPreferencesPatch = {};
  for (const key of Object.keys(patch)) {
    if (!['themeId', 'motion', 'showDiscover', 'waterfall', 'homeFilters', 'navMode'].includes(key)) {
      throw new TypeError(`不支持的界面偏好字段：${key}`);
    }
  }
  if (Object.hasOwn(patch, 'themeId')) {
    if (typeof patch.themeId !== 'string' || !THEME_IDS.has(patch.themeId)) {
      throw new TypeError('无效的主题 ID');
    }
    next.themeId = patch.themeId as UiThemeId;
  }
  if (Object.hasOwn(patch, 'motion')) {
    if (patch.motion !== 'auto' && patch.motion !== 'on' && patch.motion !== 'off') {
      throw new TypeError('无效的动效偏好');
    }
    next.motion = patch.motion;
  }
  for (const key of ['showDiscover', 'waterfall', 'homeFilters'] as const) {
    if (Object.hasOwn(patch, key)) {
      if (typeof patch[key] !== 'boolean') throw new TypeError(`无效的 ${key} 偏好`);
      next[key] = patch[key];
    }
  }
  if (Object.hasOwn(patch, 'navMode')) {
    if (patch.navMode !== 'inline' && patch.navMode !== 'window') throw new TypeError('无效的页面打开方式');
    next.navMode = patch.navMode;
  }
  return next;
}

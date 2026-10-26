// src/renderer/lib/uiPrefs.ts
// 界面偏好使用共享适配器，持久值由主进程管理，localStorage 仅作启动缓存和备份兼容。
import { useSyncExternalStore } from 'react';
import { normalizePosterSize, type PosterSize } from '../../shared/posterSize';
import type { MotionPreference } from '../../shared/uiPreferences';
import { readPreference, subscribePreference, writePreference } from '../adapters/uiPreferencesAdapter';
import { UI_PREFERENCE_KEYS } from './uiPreferenceMapping';

const KEY_DISCOVER = UI_PREFERENCE_KEYS.discover;
const subscribeShowDiscover = (notify: () => void): (() => void) => subscribePreference(KEY_DISCOVER, notify);

/** 是否展示「发现」页（默认展示；只有显式关过才是 false） */
export function getShowDiscover(): boolean {
  return readPreference(KEY_DISCOVER) !== '0';
}

/** 设置「是否展示发现页」并广播（App 侧导航与路由据此即时变化） */
export function setShowDiscover(v: boolean): void {
  writePreference(KEY_DISCOVER, v ? '1' : '0');
}

/** React Hook：订阅「是否展示发现页」（配置页切换后，侧边栏/顶部导航立即跟着变） */
export function useShowDiscover(): boolean {
  return useSyncExternalStore(subscribeShowDiscover, getShowDiscover, () => true);
}

/**
 * ★ 2026-09-30（用户要求「为现在点播分类要翻页的增加一个可以一直下拉的瀑布模式」）：
 *   点播分类浏览的「瀑布模式」（一直下滑自动加载下一页）——默认**关**（保持原来的翻页）。
 *   持久化到主进程偏好：用户点开详情再返回时模式不丢。
 */
const KEY_WATERFALL = UI_PREFERENCE_KEYS.waterfall;
const subscribeWaterfall = (notify: () => void): (() => void) => subscribePreference(KEY_WATERFALL, notify);

export function getWaterfall(): boolean {
  return readPreference(KEY_WATERFALL) === '1';
}

export function setWaterfall(v: boolean): void {
  writePreference(KEY_WATERFALL, v ? '1' : '0');
}

/** React Hook：订阅瀑布模式的共享快照。 */
export function useWaterfall(): boolean {
  return useSyncExternalStore(subscribeWaterfall, getWaterfall, () => false);
}

/**
 * ★ 2026-10-08（用户要求「整体重做界面视觉与动效交互」）：**界面动效偏好**。
 *   Windows 的「动画效果」是系统级开关（`prefers-reduced-motion`）——本机实测该开关为关时，
 *   浏览器会把一切动画/过渡折叠掉，用户看不到任何动效。所以给一个应用内三态：
 *     `auto`（默认，跟随系统）/ `on`（始终开启，无视系统）/ `off`（关闭动效）。
 *   落地方式：`<html data-motion="on|off">`（auto 时不写属性）——CSS 里据此决定是否折叠动画。
 */
export type MotionPref = MotionPreference;

const KEY_MOTION = UI_PREFERENCE_KEYS.motion;
const subscribeMotion = (notify: () => void): (() => void) =>
  subscribePreference(KEY_MOTION, () => { applyMotionPref(getMotionPref()); notify(); });

export function getMotionPref(): MotionPref {
  const v = readPreference(KEY_MOTION);
  return v === 'on' || v === 'off' ? v : 'auto';
}

/** 把偏好写到 `<html data-motion>`（auto = 移除属性，交给系统偏好） */
export function applyMotionPref(v: MotionPref): void {
  try {
    if (v === 'auto') document.documentElement.removeAttribute('data-motion');
    else document.documentElement.setAttribute('data-motion', v);
  } catch {
    /* ignore */
  }
}

export function setMotionPref(v: MotionPref): void {
  writePreference(KEY_MOTION, v);
  applyMotionPref(v);
}

/** React Hook：订阅「界面动效」偏好（配置页切换后立即生效） */
export function useMotionPref(): MotionPref {
  return useSyncExternalStore(
    subscribeMotion,
    getMotionPref,
    () => 'auto',
  );
}

/** 启动时应用（在 React 挂载前调用，避免首屏用错动效档） */
export function initMotionPref(): void {
  applyMotionPref(getMotionPref());
}

export type NavMode = 'inline' | 'window';
const KEY_NAV_MODE = UI_PREFERENCE_KEYS.navMode;
const KEY_HOME_FILTERS = UI_PREFERENCE_KEYS.homeFilters;
const subscribeNavMode = (notify: () => void): (() => void) => subscribePreference(KEY_NAV_MODE, notify);
const subscribeHomeFilters = (notify: () => void): (() => void) => subscribePreference(KEY_HOME_FILTERS, notify);
export function getNavMode(): NavMode { return readPreference(KEY_NAV_MODE) === 'window' ? 'window' : 'inline'; }
export function setNavMode(value: NavMode): void { writePreference(KEY_NAV_MODE, value); }
export function useNavMode(): NavMode { return useSyncExternalStore(subscribeNavMode, getNavMode, () => 'inline'); }
export function getHomeFilters(): boolean { return readPreference(KEY_HOME_FILTERS) === '1'; }
export function setHomeFilters(value: boolean): void { writePreference(KEY_HOME_FILTERS, value ? '1' : '0'); }
export function useHomeFilters(): boolean { return useSyncExternalStore(subscribeHomeFilters, getHomeFilters, () => false); }

const KEY_POSTER_SIZE = UI_PREFERENCE_KEYS.posterSize;
const subscribePosterSize = (notify: () => void): (() => void) => subscribePreference(KEY_POSTER_SIZE, notify);
export function getPosterSize(): PosterSize { return normalizePosterSize(readPreference(KEY_POSTER_SIZE)); }
export function setPosterSize(value: PosterSize): void { writePreference(KEY_POSTER_SIZE, value); }
export function usePosterSize(): PosterSize { return useSyncExternalStore(subscribePosterSize, getPosterSize, () => 'medium'); }

import { useSyncExternalStore } from 'react';
import { client } from '../api/client';
import { getPosterSize } from './uiPrefs';
import { subscribePreference } from './preferenceStore';
import { posterIntrinsicHeight, posterWidth } from '../../shared/posterSize';
import type { UiScalePref, UiScaleState } from '../../shared/uiScale';

const fallback: UiScaleState = { pref: 'auto', scale: 1, work: { width: 0, height: 0 } };
let state = fallback;
let initialized = false;
let revision = 0;
const listeners = new Set<() => void>();

function applyPosterSizing(): void {
  const root = document.documentElement;
  root.style.setProperty('--poster-width', posterWidth(getPosterSize(), state.scale) + 'px');
  root.style.setProperty('--poster-intrinsic-height', posterIntrinsicHeight(getPosterSize(), state.scale) + 'px');
  root.style.setProperty('--poster-gap', 18 / state.scale + 'px');
  root.style.setProperty('--ui-zoom', String(state.scale));
  root.dataset.posterSize = getPosterSize();
}

function acceptScale(value: UiScaleState): void {
  if (!value || ![1, 1.25, 1.5, 1.75, 2].includes(value.scale)) return;
  state = value;
  revision++;
  applyPosterSizing();
  for (const notify of listeners) notify();
}

/** Use the app zoom, excluding Windows DPI scaling, when sizing gallery posters. */
export async function initDisplayPrefs(): Promise<void> {
  if (initialized) { applyPosterSizing(); return; }
  initialized = true;
  subscribePreference('winbox-poster-size', applyPosterSizing);
  client.onUiScaleChanged(acceptScale);
  applyPosterSizing();
  const requestedAt = revision;
  try {
    const value = await client.uiGetScale();
    if (requestedAt === revision) acceptScale(value);
  } catch { /* Browser previews use the default scale. */ }
}

const subscribe = (notify: () => void): (() => void) => { listeners.add(notify); return () => { listeners.delete(notify); }; };
export function useUiScaleState(): UiScaleState { return useSyncExternalStore(subscribe, () => state, () => fallback); }
export async function setUiScale(value: UiScalePref): Promise<void> { acceptScale(await client.uiSetScale(value)); }

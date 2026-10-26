import { useSyncExternalStore } from 'react';
import { subscribePreference } from '../../../adapters/uiPreferencesAdapter';
import { UI_PREFERENCE_KEYS } from '../../../lib/uiPreferenceMapping';
import { allSkins, DEFAULT_THEME, normalizeTheme, skinLayout } from '../../../lib/themeTokens';
import type { ThemeLayout } from '../../../../shared/plugin';
import { themeApplication } from '../themeRuntime';
import { THEME_EVENT, THEMES_EVENT } from '../application/themeEvents';

type ThemeSnapshot = {
  key: string;
  theme: ReturnType<typeof normalizeTheme>;
  layout: ThemeLayout;
  skins: ReturnType<typeof allSkins>;
};

let registryRevision = 0;
let cachedSnapshot: ThemeSnapshot | undefined;
const serverSnapshot: ThemeSnapshot = {
  key: DEFAULT_THEME + ':0',
  theme: DEFAULT_THEME,
  layout: skinLayout(DEFAULT_THEME),
  skins: allSkins(),
};

function snapshot(): ThemeSnapshot {
  const theme = themeApplication.currentTheme();
  const key = theme + ':' + registryRevision;
  if (cachedSnapshot?.key !== key) cachedSnapshot = { key, theme, layout: skinLayout(theme), skins: allSkins() };
  return cachedSnapshot;
}

function subscribeTheme(notify: () => void): () => void {
  const off = subscribePreference(UI_PREFERENCE_KEYS.theme, () => {
    themeApplication.initialize();
    notify();
  });
  const onThemeChanged = () => notify();
  const onThemesChanged = () => {
    registryRevision += 1;
    notify();
  };
  window.addEventListener(THEME_EVENT, onThemeChanged);
  window.addEventListener(THEMES_EVENT, onThemesChanged);
  return () => {
    off();
    window.removeEventListener(THEME_EVENT, onThemeChanged);
    window.removeEventListener(THEMES_EVENT, onThemesChanged);
  };
}

const getServerSnapshot = () => serverSnapshot;

export function useTheme() {
  return useSyncExternalStore(subscribeTheme, snapshot, getServerSnapshot).theme;
}

export function useSkinLayout(): ThemeLayout {
  return useSyncExternalStore(subscribeTheme, snapshot, getServerSnapshot).layout;
}

export function useSkins() {
  return useSyncExternalStore(subscribeTheme, snapshot, getServerSnapshot).skins;
}

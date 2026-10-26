import { readPreference, writePreference } from '../../adapters/uiPreferencesAdapter';
import { UI_PREFERENCE_KEYS } from '../../lib/uiPreferenceMapping';
import { allSkins, registerPluginSkins } from '../../lib/themeTokens';
import { createThemeApplication } from './application/themeApplication';
import { THEME_EVENT, THEMES_EVENT } from './application/themeEvents';
import { themeDocumentAdapter } from './adapters/themeDocumentAdapter';

const themeKey = UI_PREFERENCE_KEYS.theme;

export const themeApplication = createThemeApplication({
  preferences: {
    readTheme: () => readPreference(themeKey),
    writeTheme: (theme) => writePreference(themeKey, theme),
  },
  registry: {
    register: registerPluginSkins,
    list: allSkins,
  },
  document: themeDocumentAdapter,
  events: {
    themeChanged: () => window.dispatchEvent(new Event(THEME_EVENT)),
    themesChanged: () => window.dispatchEvent(new Event(THEMES_EVENT)),
  },
});

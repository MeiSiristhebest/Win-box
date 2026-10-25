import { DEFAULT_THEME, normalizeTheme, type SkinEntry, type Theme } from '../../../../shared/ui/themeTokens';
import type { ThemeSkinView } from '../../../../shared/plugin';

export interface ThemePreferencesPort {
  readTheme(): string | null;
  writeTheme(theme: Theme): void;
}

export interface ThemeRegistryPort {
  register(skins: ThemeSkinView[] | undefined): void;
  list(): SkinEntry[];
}

export interface ThemeDocumentPort {
  currentTheme(): Theme;
  apply(theme: Theme): void;
  installPluginStyles(skins: SkinEntry[]): void;
}

export interface ThemeEventsPort {
  themeChanged(): void;
  themesChanged(): void;
}

export interface ThemeApplicationPorts {
  preferences: ThemePreferencesPort;
  registry: ThemeRegistryPort;
  document: ThemeDocumentPort;
  events: ThemeEventsPort;
}

/** Coordinates theme use cases without owning browser, React, or persistence APIs. */
export function createThemeApplication(ports: ThemeApplicationPorts) {
  function applyTheme(value: Theme): void {
    const theme = normalizeTheme(value);
    ports.document.apply(theme);
    ports.preferences.writeTheme(theme);
    ports.events.themeChanged();
  }

  function synchronizePluginThemeRegistry(skins?: ThemeSkinView[]): void {
    const registryReady = skins !== undefined;
    if (registryReady) ports.registry.register(skins);

    ports.document.installPluginStyles(ports.registry.list());
    const storedTheme = ports.preferences.readTheme();
    const theme = normalizeTheme(storedTheme);
    ports.document.apply(theme);
    if (registryReady && storedTheme && storedTheme !== theme) ports.preferences.writeTheme(theme);
    ports.events.themesChanged();
  }

  function initialize(): Theme {
    const theme = normalizeTheme(ports.preferences.readTheme() ?? DEFAULT_THEME);
    ports.document.apply(theme);
    return ports.document.currentTheme();
  }

  return {
    applyTheme,
    synchronizePluginThemeRegistry,
    initialize,
    currentTheme: ports.document.currentTheme,
  };
}

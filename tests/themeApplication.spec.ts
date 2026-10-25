import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_THEME } from '../src/shared/ui/themeTokens';
import type { ThemeSkinView } from '../src/shared/plugin';
import type { SkinEntry } from '../src/shared/ui/themeTokens';
import { createThemeApplication } from '../src/renderer/features/theme/application/themeApplication';
import type { Theme } from '../src/renderer/lib/themeTokens';

function setup(initialTheme: string | null = 'dark') {
  let storedTheme = initialTheme;
  let activeTheme: Theme = DEFAULT_THEME;
  const ports = {
    preferences: {
      readTheme: () => storedTheme,
      writeTheme: vi.fn((theme: Theme) => { storedTheme = theme; }),
    },
    registry: {
      register: vi.fn((_next: ThemeSkinView[] | undefined) => {}),
      list: (): SkinEntry[] => [],
    },
    document: {
      currentTheme: () => activeTheme,
      apply: vi.fn((theme: Theme) => { activeTheme = theme; }),
      installPluginStyles: vi.fn(),
    },
    events: {
      themeChanged: vi.fn(),
      themesChanged: vi.fn(),
    },
  };
  return { app: createThemeApplication(ports), ports };
}

describe('theme application', () => {
  it('applies the normalized theme before persisting and notifying subscribers', () => {
    const { app, ports } = setup();

    app.applyTheme('light');

    expect(ports.document.apply).toHaveBeenCalledWith('light');
    expect(ports.preferences.writeTheme).toHaveBeenCalledWith('light');
    expect(ports.events.themeChanged).toHaveBeenCalledOnce();
  });

  it('initializes from preferences without writing preferences back', () => {
    const { app, ports } = setup('light');

    expect(app.initialize()).toBe('light');
    expect(ports.document.apply).toHaveBeenCalledWith('light');
    expect(ports.preferences.writeTheme).not.toHaveBeenCalled();
  });

  it('does not replace the plugin registry while synchronization is pending', () => {
    const { app, ports } = setup('dark');

    app.synchronizePluginThemeRegistry();

    expect(ports.registry.register).not.toHaveBeenCalled();
    expect(ports.document.installPluginStyles).toHaveBeenCalledWith([]);
    expect(ports.document.apply).toHaveBeenCalledWith('dark');
    expect(ports.events.themesChanged).toHaveBeenCalledOnce();
  });

  it('normalizes and persists a removed theme after the registry becomes authoritative', () => {
    const { app, ports } = setup('plugin:removed-skin');

    app.synchronizePluginThemeRegistry([]);

    expect(ports.registry.register).toHaveBeenCalledWith([]);
    expect(ports.document.apply).toHaveBeenCalledWith(DEFAULT_THEME);
    expect(ports.preferences.writeTheme).toHaveBeenCalledWith(DEFAULT_THEME);
    expect(ports.document.installPluginStyles).toHaveBeenCalledWith([]);
  });
});

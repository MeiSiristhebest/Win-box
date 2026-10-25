import { DEFAULT_THEME, themes as sharedThemes } from '../src/shared/ui/themeTokens';
import { DEFAULT_UI_PREFERENCES, UI_THEME_IDS } from '../src/shared/uiPreferences';
import { wcagContrastRatio } from '../src/shared/ui/colorContrast';
import { describe, expect, it } from 'vitest';
import { colorSchemeFor, normalizeTheme, presentationFor, SEMANTIC_TOKEN_NAMES, themes, type Theme } from '../src/renderer/lib/themeTokens';
import { readGlobalStyleComposition } from './helpers/globalStyles';
import { createPluginThemeRegistryLoader } from '../src/renderer/features/theme/application/pluginThemeRegistry';

describe('theme registry', () => {
  it('ignores a stale plugin-theme response when a newer refresh has started', async () => {
    const pending: Array<(skins: { id: string }[]) => void> = [];
    const applied: ({ id: string }[] | undefined)[] = [];
    const load = createPluginThemeRegistryLoader<{ id: string }>({
      fetch: () => new Promise<{ id: string }[]>((resolve) => pending.push(resolve)),
      synchronize: (skins) => applied.push(skins),
    });

    const older = load();
    const newer = load();
    pending[1]([{ id: 'newer' }]);
    await newer;
    pending[0]([{ id: 'older' }]);
    await older;

    expect(applied).toEqual([[{ id: 'newer' }]]);
  });

  it('resynchronizes the active theme after a registry fetch failure without replacing registered skins', async () => {
    const applied: ({ id: string }[] | undefined)[] = [];
    const load = createPluginThemeRegistryLoader<{ id: string }>({
      fetch: async () => { throw new Error('offline'); },
      synchronize: (skins) => applied.push(skins),
    });

    await load();

    expect(applied).toEqual([undefined]);
  });

  it('measures readable contrast after alpha surfaces are composited over their base', () => {
    const blackTextOnTranslucentWhite = wcagContrastRatio('#000000', 'rgba(255,255,255,.1)', '#000000');
    const whiteTextOnTranslucentWhite = wcagContrastRatio('#ffffff', 'rgba(255,255,255,.1)', '#000000');

    expect(blackTextOnTranslucentWhite).not.toBeNull();
    expect(blackTextOnTranslucentWhite!).toBeLessThan(1.5);
    expect(whiteTextOnTranslucentWhite).not.toBeNull();
    expect(whiteTextOnTranslucentWhite!).toBeGreaterThan(10);
  });

  it('defines a complete presentation and color scheme for every theme', () => {
    const themeIds = Object.keys(themes) as Theme[];
    expect(themeIds).toEqual([...UI_THEME_IDS]);
    expect(Object.keys(sharedThemes)).toEqual([...UI_THEME_IDS]);
    expect(DEFAULT_UI_PREFERENCES.themeId).toBe(DEFAULT_THEME);

    for (const theme of themeIds) {
      const presentation = presentationFor(theme);
      expect(presentation.shell).toBeTruthy();
      expect(presentation.discover).toBeTruthy();
      expect(presentation.detail).toBeTruthy();
      expect(['light', 'dark']).toContain(colorSchemeFor(theme));
      expect(normalizeTheme(theme)).toBe(theme);
      expect(Object.keys(themes[theme].tokens).sort()).toEqual([...SEMANTIC_TOKEN_NAMES].sort());
      for (const name of SEMANTIC_TOKEN_NAMES) expect(themes[theme].tokens[name].trim()).not.toBe('');
    }
  });

  it('keeps built-in text and status labels readable on every semantic surface', () => {
    for (const [themeId, definition] of Object.entries(themes)) {
      const { tokens } = definition;
      for (const foreground of ['text-primary', 'text-secondary'] as const) {
        for (const background of ['surface', 'surface-raised', 'surface-elevated'] as const) {
          const ratio = wcagContrastRatio(tokens[foreground], tokens[background]);
          expect(ratio, `${themeId}: ${foreground} on ${background}`).not.toBeNull();
          expect(ratio!, `${themeId}: ${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
        }
      }
      for (const [foreground, background] of [['on-accent', 'color-accent'], ['on-danger', 'color-danger']] as const) {
        const ratio = wcagContrastRatio(tokens[foreground], tokens[background]);
        expect(ratio, `${themeId}: ${foreground} on ${background}`).not.toBeNull();
        expect(ratio!, `${themeId}: ${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('uses the existing light color scheme for Bilibili', () => {
    expect(colorSchemeFor('bilibili')).toBe('light');
  });

  it('defines the semantic component tokens after the legacy theme layer', async () => {
    const { css } = await readGlobalStyleComposition();
    expect(css).toContain('@layer reset, legacy, tokens, base, components, layouts, utilities, desktop;');

    for (const token of SEMANTIC_TOKEN_NAMES) {
      expect(css).toMatch(new RegExp(`--${token.replaceAll('-', '\\-')}\\s*:`));
    }

  });
});

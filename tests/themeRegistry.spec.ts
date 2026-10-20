import { DEFAULT_THEME, themes as sharedThemes } from '../src/shared/ui/themeTokens';
import { DEFAULT_UI_PREFERENCES, UI_THEME_IDS } from '../src/shared/uiPreferences';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { colorSchemeFor, normalizeTheme, presentationFor, SEMANTIC_TOKEN_NAMES, themes, type Theme } from '../src/renderer/lib/themeTokens';

describe('theme registry', () => {
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

  it('uses the existing light color scheme for Bilibili', () => {
    expect(colorSchemeFor('bilibili')).toBe('light');
  });

  it('defines the semantic component tokens after the legacy theme layer', async () => {
    const css = await readFile(new URL('../src/renderer/styles/global.css', import.meta.url), 'utf8');
    expect(css).toContain('@layer reset, legacy, tokens, base, components, layouts, utilities, desktop;');

    for (const token of SEMANTIC_TOKEN_NAMES) {
      expect(css).toMatch(new RegExp(`--${token.replaceAll('-', '\\-')}\\s*:`));
    }

  });
});

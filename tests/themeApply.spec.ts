// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { applyTheme, useTheme, useSkinLayout } from '../src/renderer/lib/theme';
import { registerPluginSkins, SEMANTIC_TOKEN_NAMES, themes, type Theme } from '../src/renderer/lib/themeTokens';

describe('theme application', () => {
  const values = { themeId: 'dark', motion: 'auto', showDiscover: true, waterfall: false };
  const updateUiPreferences = vi.fn((patch: Record<string, unknown>) => {
    Object.assign(values, patch);
    return Promise.resolve({ ok: true, data: { revision: 1, initialized: true, values: { ...values } } });
  });

  beforeEach(() => {
    Object.assign(values, { themeId: 'dark', motion: 'auto', showDiscover: true, waterfall: false });
    updateUiPreferences.mockClear();
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { system: { updateUiPreferences } },
    });
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('style');
    Reflect.deleteProperty(window, 'api');
    registerPluginSkins([]);
  });

  it('applies a complete token snapshot and persists each selected theme', () => {
    const themeIds = Object.keys(themes) as Theme[];
    for (const theme of themeIds) {
      applyTheme(theme);
      expect(document.documentElement.getAttribute('data-theme')).toBe(theme);
      for (const token of SEMANTIC_TOKEN_NAMES) {
        expect(document.documentElement.style.getPropertyValue(`--${token}`)).toBe(themes[theme].tokens[token]);
      }
    }

    expect(updateUiPreferences).toHaveBeenCalledTimes(themeIds.length);
    themeIds.forEach((themeId, index) => expect(updateUiPreferences).toHaveBeenNthCalledWith(index + 1, { themeId }));
  });

  it('publishes the selected theme and layout from the same subscribed snapshot', () => {
    applyTheme('dark');
    const { result } = renderHook(() => ({ theme: useTheme(), layout: useSkinLayout() }));
    expect(result.current.theme).toBe('dark');
    expect(result.current.layout.shell).toBe('topbar');
    act(() => applyTheme('light'));
    expect(result.current.theme).toBe('light');
    expect(result.current.layout.shell).toBe('topbar');
    act(() => {
      registerPluginSkins([{
        id: 'plugin:test-layout', pluginId: 'test', label: '测试外观', base: 'light',
        tokens: { '--surface-0': '#ffffff' },
        layout: { shell: 'sidebar' },
      }]);
      applyTheme('plugin:test-layout');
    });
    expect(result.current.theme).toBe('plugin:test-layout');
    expect(result.current.layout.shell).toBe('sidebar');
  });
});

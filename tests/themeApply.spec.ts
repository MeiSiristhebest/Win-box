// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { applyTheme, useTheme, useSkinLayout } from '../src/renderer/lib/theme';
import { SEMANTIC_TOKEN_NAMES, themes, type Theme } from '../src/renderer/lib/themeTokens';

describe('theme application', () => {
  const values = { themeId: 'netflix', motion: 'auto', showDiscover: true, waterfall: false };
  const updateUiPreferences = vi.fn((patch: Record<string, unknown>) => {
    Object.assign(values, patch);
    return Promise.resolve({ ok: true, data: { revision: 1, initialized: true, values: { ...values } } });
  });

  beforeEach(() => {
    Object.assign(values, { themeId: 'netflix', motion: 'auto', showDiscover: true, waterfall: false });
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
    applyTheme('netflix');
    const { result } = renderHook(() => ({ theme: useTheme(), layout: useSkinLayout() }));
    expect(result.current.theme).toBe('netflix');
    expect(result.current.layout.shell).toBe('topbar');
    act(() => applyTheme('apple'));
    expect(result.current.theme).toBe('apple');
    expect(result.current.layout.shell).toBe('sidebar');
    act(() => applyTheme('bilibili'));
    expect(result.current.theme).toBe('bilibili');
    expect(result.current.layout.shell).toBe('dualbar');
  });
});

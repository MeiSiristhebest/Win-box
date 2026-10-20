// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppearanceSection } from '../src/renderer/features/settings/AppearanceSection';

describe('AppearanceSection', () => {
  const values = { themeId: 'dark', motion: 'auto', showDiscover: true, waterfall: false };
  let revision = 0;
  const updateUiPreferences = vi.fn((patch: Record<string, unknown>) => {
    Object.assign(values, patch);
    revision += 1;
    return Promise.resolve({ ok: true, data: { revision, initialized: true, values: { ...values } } });
  });

  beforeEach(() => {
    Object.assign(values, { themeId: 'dark', motion: 'auto', showDiscover: true, waterfall: false });
    updateUiPreferences.mockClear();
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { system: { updateUiPreferences } },
    });
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-motion');
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-motion');
    document.documentElement.removeAttribute('style');
    Reflect.deleteProperty(window, 'api');
  });

  it('renders each registered theme and applies the selected theme', async () => {
    render(<AppearanceSection />);

    const group = screen.getByRole('radiogroup', { name: '外观主题' });
    expect(group.querySelectorAll('input[type="radio"]')).toHaveLength(2);

    fireEvent.click(screen.getByRole('radio', { name: /^浅色/ }));
    expect(updateUiPreferences).toHaveBeenCalledWith({ themeId: 'light' });
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
      expect((screen.getByRole('radio', { name: /^浅色/ }) as HTMLInputElement).checked).toBe(true);
    });
  });

  it('stores motion and discover preferences through their shared preference APIs', async () => {
    render(<AppearanceSection />);

    fireEvent.click(screen.getByRole('radio', { name: /关闭动效/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /展示「发现」页/ }));

    await waitFor(() => {
      expect(localStorage.getItem('winbox-motion')).toBe('off');
      expect(document.documentElement.getAttribute('data-motion')).toBe('off');
      expect(localStorage.getItem('winbox-show-discover')).toBe('0');
    });
  });
});

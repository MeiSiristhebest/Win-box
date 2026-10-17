// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ComponentShowcasePage from '../src/renderer/pages/ComponentShowcasePage';

describe('development component showcase', () => {
  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('style');
    Reflect.deleteProperty(window, 'api');
  });

  it('renders shared control states and applies a selected theme', async () => {
    const values = { themeId: 'netflix', motion: 'auto', showDiscover: true, waterfall: false };
    let revision = 0;
    const updateUiPreferences = vi.fn((patch: Record<string, unknown>) => {
      Object.assign(values, patch);
      revision += 1;
      return Promise.resolve({ ok: true, data: { revision, initialized: true, values: { ...values } } });
    });
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { system: { updateUiPreferences } },
    });
    document.documentElement.setAttribute('data-theme', 'netflix');

    render(<ComponentShowcasePage />);

    expect((screen.getByRole('button', { name: '主要操作' }) as HTMLButtonElement).disabled).toBe(false);
    const loading = screen.getByRole('button', { name: '处理中' });
    expect((loading as HTMLButtonElement).disabled).toBe(true);
    expect(loading.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByLabelText('订阅名称')).toBeTruthy();
    expect(screen.getByLabelText('无效示例').getAttribute('aria-invalid')).toBe('true');

    fireEvent.change(screen.getByRole('combobox', { name: '展示主题' }), { target: { value: 'bilibili' } });

    expect(document.documentElement.getAttribute('data-theme')).toBe('bilibili');
    expect(updateUiPreferences).toHaveBeenLastCalledWith({ themeId: 'bilibili' });
    await waitFor(() => expect(screen.getByText('当前主题：bilibili')).toBeTruthy());
  });
});

// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UserConfig } from '../src/shared/types';
import { ProfileSwitcher } from '../src/renderer/features/subscriptions/ProfileSwitcher';
import type { ProfileSwitcherPort } from '../src/renderer/features/subscriptions/application/profileSwitcherPort';
import { profileChoices } from '../src/renderer/features/subscriptions/profileChoices';
import { profileConfig } from './fixtures/profileSwitchData';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function setup() {
  const a = profileConfig('A');
  const b = profileConfig('B', false);
  let config = { ...a, profiles: [...a.profiles, ...b.profiles], subscriptionGroups: [{ id: 'group', name: '测试多仓', url: 'https://example.test/repos', status: 'partial' as const, createdAt: '', updatedAt: '', members: [{ id: 'a', name: 'A子仓', url: a.apiUrl, profileId: 'A', status: 'ready' as const }, { id: 'b', name: 'B子仓', url: b.apiUrl, profileId: 'B', status: 'ready' as const }, { id: 'failed', name: '失败子仓', url: 'https://example.test/missing', status: 'failed' as const, error: 'HTTP 404' }] }] };
  const port: ProfileSwitcherPort = {
    loadConfiguration: vi.fn(async () => config as unknown as UserConfig),
    activateProfile: vi.fn(async id => { config = { ...config, ...(id === 'B' ? b : a), profiles: config.profiles, subscriptionGroups: config.subscriptionGroups }; }),
    publishProfileChanged: vi.fn(() => {
      window.dispatchEvent(new CustomEvent('winbox:profile-changed'));
      window.dispatchEvent(new CustomEvent('winbox:sources-changed'));
    }),
    subscribeToProfileRefresh: vi.fn(listener => {
      window.addEventListener('winbox:sources-changed', listener);
      return () => window.removeEventListener('winbox:sources-changed', listener);
    }),
  };
  render(<MemoryRouter><ProfileSwitcher port={port} /></MemoryRouter>);
  return { a, b, config, activate: vi.mocked(port.activateProfile) };
}

describe('ProfileSwitcher', () => {
  it('lists live-only children and explains unavailable members', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /切换子仓/ }));
    expect(await screen.findByRole('dialog', { name: '切换子仓' })).toBeTruthy();
    const liveOnly = await screen.findByRole('button', { name: /B子仓.*0 个站点.*1 条直播/ });
    expect((liveOnly as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: /失败子仓.*HTTP 404/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: '筛选子仓' }), { target: { value: 'B子仓' } });
    expect(screen.queryByRole('button', { name: /A子仓.*当前/ })).toBeNull();
    expect(screen.getByRole('button', { name: /B子仓/ })).toBeTruthy();
  });

  it('activates once and notifies site and live consumers only after success', async () => {
    const { activate } = setup();
    const profileChanged = vi.fn();
    const sourcesChanged = vi.fn();
    window.addEventListener('winbox:profile-changed', profileChanged);
    window.addEventListener('winbox:sources-changed', sourcesChanged);
    try {
      fireEvent.click(screen.getByRole('button', { name: /切换子仓/ }));
      const target = await screen.findByRole('button', { name: /B子仓.*0 个站点/ });
      fireEvent.click(target);
      fireEvent.click(target);
      await waitFor(() => expect(activate).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(profileChanged).toHaveBeenCalledTimes(1));
      expect(sourcesChanged).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    } finally { window.removeEventListener('winbox:profile-changed', profileChanged); window.removeEventListener('winbox:sources-changed', sourcesChanged); }
  });

  it('shows activation failures and keeps the current repository', async () => {
    const { activate } = setup();
    activate.mockRejectedValue(new Error('配置快照无法恢复'));
    fireEvent.click(screen.getByRole('button', { name: /切换子仓/ }));
    fireEvent.click(await screen.findByRole('button', { name: /B子仓.*0 个站点/ }));
    expect((await screen.findByRole('alert')).textContent).toContain('配置快照无法恢复');
    expect(screen.getByRole('button', { name: /A子仓.*当前/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('retains an offline snapshot when the latest child refresh failed', () => {
    const a = profileConfig('A');
    a.subscriptionGroups = [{ id: 'g', name: '组', url: '', status: 'partial', createdAt: '', updatedAt: '', members: [{ id: 'm', name: 'A', url: '', status: 'failed', error: '超时', profileId: 'A' }] }];
    expect(profileChoices(a)[0]).toMatchObject({ restorable: true, reason: '刷新失败，可使用已保存配置' });
  });
});

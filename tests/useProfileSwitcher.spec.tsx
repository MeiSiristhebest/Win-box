// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserConfig } from '../src/shared/types';
import type { ProfileSwitcherPort } from '../src/renderer/features/subscriptions/application/profileSwitcherPort';
import { useProfileSwitcher } from '../src/renderer/features/subscriptions/useProfileSwitcher';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function configuration(activeProfileId = 'profile-a'): UserConfig {
  return {
    activeProfileId,
    profiles: [
      { id: 'profile-a', name: 'Archive', sourceCount: 1, json: JSON.stringify({ sites: [], lives: [] }) },
      { id: 'profile-b', name: 'Dragon', sourceCount: 2, json: JSON.stringify({ sites: [], lives: [] }) },
    ],
    subscriptionGroups: [],
    sources: [],
    lives: [],
  } as unknown as UserConfig;
}

let onProfileRefresh: (() => void) | null = null;
const unsubscribe = vi.fn();
const port: ProfileSwitcherPort = {
  loadConfiguration: vi.fn(async () => configuration()),
  activateProfile: vi.fn(async () => undefined),
  publishProfileChanged: vi.fn(() => { onProfileRefresh?.(); }),
  subscribeToProfileRefresh: vi.fn(listener => {
    onProfileRefresh = listener;
    return unsubscribe;
  }),
};

beforeEach(() => {
  vi.clearAllMocks();
  onProfileRefresh = null;
  vi.mocked(port.loadConfiguration).mockResolvedValue(configuration());
  vi.mocked(port.activateProfile).mockResolvedValue(undefined);
  vi.mocked(port.subscribeToProfileRefresh).mockImplementation(listener => {
    onProfileRefresh = listener;
    return unsubscribe;
  });
});

describe('useProfileSwitcher', () => {
  it('loads choices through its port and derives the active profile label', async () => {
    const { result } = renderHook(() => useProfileSwitcher({ port, query: '' }));

    await waitFor(() => expect(result.current.model.choices).toHaveLength(2));

    expect(port.loadConfiguration).toHaveBeenCalledOnce();
    expect(result.current.model.activeLabel).toBe('Archive');
    expect(result.current.model.filtered.map(choice => choice.profileId)).toEqual(['profile-a', 'profile-b']);
  });

  it('filters by profile name without changing the loaded profile set', async () => {
    const { result, rerender } = renderHook(({ query }) => useProfileSwitcher({ port, query }), { initialProps: { query: '' } });
    await waitFor(() => expect(result.current.model.choices).toHaveLength(2));
    rerender({ query: 'dra' });

    expect(result.current.model.choices).toHaveLength(2);
    expect(result.current.model.filtered.map(choice => choice.profileId)).toEqual(['profile-b']);
  });

  it('activates a profile, publishes the change, reloads configuration, and reports success', async () => {
    vi.mocked(port.loadConfiguration)
      .mockResolvedValueOnce(configuration())
      .mockResolvedValueOnce(configuration('profile-b'));
    const { result } = renderHook(() => useProfileSwitcher({ port, query: '' }));
    await waitFor(() => expect(port.loadConfiguration).toHaveBeenCalledOnce());

    let activated = false;
    await act(async () => { activated = await result.current.actions.activate('profile-b'); });

    expect(activated).toBe(true);
    expect(port.activateProfile).toHaveBeenCalledWith('profile-b');
    expect(port.publishProfileChanged).toHaveBeenCalledOnce();
    expect(port.loadConfiguration).toHaveBeenCalledTimes(2);
    expect(result.current.model.activeLabel).toBe('Dragon');
  });

  it('keeps one activation in flight and ignores a duplicate activation request', async () => {
    let finishActivation!: () => void;
    vi.mocked(port.activateProfile).mockImplementationOnce(() => new Promise<void>(resolve => { finishActivation = resolve; }));
    const { result } = renderHook(() => useProfileSwitcher({ port, query: '' }));
    await waitFor(() => expect(result.current.model.choices).toHaveLength(2));

    let firstActivation!: Promise<boolean>;
    await act(async () => {
      firstActivation = result.current.actions.activate('profile-b');
      await Promise.resolve();
      await expect(result.current.actions.activate('profile-a')).resolves.toBe(false);
    });
    expect(port.activateProfile).toHaveBeenCalledOnce();

    await act(async () => { finishActivation(); await firstActivation; });
  });

  it('refreshes on profile events and unsubscribes when the controller unmounts', async () => {
    const { unmount } = renderHook(() => useProfileSwitcher({ port, query: '' }));
    await waitFor(() => expect(port.loadConfiguration).toHaveBeenCalledOnce());

    await act(async () => { onProfileRefresh?.(); });
    await waitFor(() => expect(port.loadConfiguration).toHaveBeenCalledTimes(2));
    unmount();

    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('maps failures from non-Error IPC rejections to an actionable message', async () => {
    vi.mocked(port.loadConfiguration).mockRejectedValueOnce('profile store offline');
    const { result } = renderHook(() => useProfileSwitcher({ port, query: '' }));

    await waitFor(() => expect(result.current.model.error).toBe('profile store offline'));
  });
});

// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ProfileActivationPort } from '../src/renderer/features/settings/application/configurationPagePorts';
import { useConfigurationProfileActivation } from '../src/renderer/features/settings/useConfigurationProfileActivation';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}

describe('useConfigurationProfileActivation', () => {
  it('activates, announces, refreshes, and releases the shared busy state in order', async () => {
    const order: string[] = [];
    const profile: ProfileActivationPort = {
      activate: vi.fn(async () => { order.push('activate'); }),
      announceProfileChanged: vi.fn(() => { order.push('announce'); }),
    };
    const refreshConfiguration = vi.fn(async () => { order.push('refresh'); });
    const setBusy = vi.fn();
    const { result } = renderHook(() => useConfigurationProfileActivation({
      profile, refreshConfiguration, busy: false, setBusy, importRunning: false,
    }));

    await act(async () => { await expect(result.current.activate('profile-2')).resolves.toBe(true); });

    expect(order).toEqual(['activate', 'announce', 'refresh']);
    expect(setBusy.mock.calls.map(([value]) => value)).toEqual([true, false]);
    expect(result.current.error).toBe('');
  });

  it('does not activate while settings work or an import is already running', async () => {
    const profile: ProfileActivationPort = { activate: vi.fn(), announceProfileChanged: vi.fn() };
    const setBusy = vi.fn();
    const { result, rerender } = renderHook(({ busy, importRunning }) => useConfigurationProfileActivation({
      profile, refreshConfiguration: vi.fn(), busy, setBusy, importRunning,
    }), { initialProps: { busy: true, importRunning: false } });

    await act(async () => { await expect(result.current.activate('profile-2')).resolves.toBe(false); });
    rerender({ busy: false, importRunning: true });
    await act(async () => { await expect(result.current.activate('profile-2')).resolves.toBe(false); });

    expect(profile.activate).not.toHaveBeenCalled();
    expect(setBusy).not.toHaveBeenCalled();
  });

  it('ignores duplicate activation while the first request is in flight', async () => {
    const request = deferred<void>();
    const profile: ProfileActivationPort = {
      activate: vi.fn(() => request.promise), announceProfileChanged: vi.fn(),
    };
    const setBusy = vi.fn();
    const { result } = renderHook(() => useConfigurationProfileActivation({
      profile, refreshConfiguration: vi.fn(), busy: false, setBusy, importRunning: false,
    }));
    let first!: Promise<boolean>;
    act(() => { first = result.current.activate('profile-2'); });
    await act(async () => { await expect(result.current.activate('profile-3')).resolves.toBe(false); });
    expect(profile.activate).toHaveBeenCalledOnce();

    await act(async () => { request.resolve(undefined); await first; });
    expect(setBusy.mock.calls.map(([value]) => value)).toEqual([true, false]);
  });

  it('maps non-Error failures to text and clears the error before a retry', async () => {
    const profile: ProfileActivationPort = {
      activate: vi.fn().mockRejectedValueOnce('profile store unavailable').mockResolvedValueOnce(undefined),
      announceProfileChanged: vi.fn(),
    };
    const setBusy = vi.fn();
    const { result } = renderHook(() => useConfigurationProfileActivation({
      profile, refreshConfiguration: vi.fn(), busy: false, setBusy, importRunning: false,
    }));

    await act(async () => { await expect(result.current.activate('profile-2')).resolves.toBe(false); });
    expect(result.current.error).toBe('profile store unavailable');
    await act(async () => { await expect(result.current.activate('profile-2')).resolves.toBe(true); });
    expect(result.current.error).toBe('');
    expect(setBusy.mock.calls.map(([value]) => value)).toEqual([true, false, true, false]);
  });
});

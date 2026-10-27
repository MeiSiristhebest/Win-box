// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuxiliaryWindowNavigationPort } from '../src/renderer/features/appShell/application/auxiliaryWindowNavigationPort';
import { useAuxiliaryWindowNavigation } from '../src/renderer/features/appShell/useAuxiliaryWindowNavigation';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('auxiliary window navigation session', () => {
  it('applies late routes, acknowledges readiness, and cancels both subscriptions on unmount', () => {
    let receiveRoute: ((route: string) => void) | undefined;
    let runReady: (() => void) | undefined;
    const stopNavigation = vi.fn();
    const cancelSchedule = vi.fn();
    const announceReady = vi.fn().mockResolvedValue(undefined);
    const port: AuxiliaryWindowNavigationPort = {
      subscribeToNavigation(listener) { receiveRoute = listener; return stopNavigation; },
      announceReady,
      schedule(callback) { runReady = callback; return cancelSchedule; },
    };
    const navigate = vi.fn();
    const view = renderHook(() => useAuxiliaryWindowNavigation({ enabled: true, navigate, port }));

    act(() => receiveRoute?.('/detail/movie/1'));
    expect(navigate).toHaveBeenCalledWith('/detail/movie/1');
    act(() => runReady?.());
    expect(announceReady).toHaveBeenCalledOnce();
    view.unmount();
    expect(stopNavigation).toHaveBeenCalledOnce();
    expect(cancelSchedule).toHaveBeenCalledOnce();
  });

  it('does not subscribe or announce readiness for the main window', () => {
    const subscribeToNavigation = vi.fn(() => () => undefined);
    const schedule = vi.fn(() => () => undefined);
    const port: AuxiliaryWindowNavigationPort = {
      subscribeToNavigation,
      schedule,
      announceReady: vi.fn().mockResolvedValue(undefined),
    };
    renderHook(() => useAuxiliaryWindowNavigation({ enabled: false, navigate: vi.fn(), port }));
    expect(subscribeToNavigation).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });
});

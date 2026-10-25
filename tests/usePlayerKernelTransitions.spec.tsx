// @vitest-environment happy-dom
import { StrictMode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePlayerKernelTransitions } from '../src/renderer/features/playback/usePlayerKernelTransitions';
import type { PlayerKernelSnapshot, PlayerKernelTransitionPorts } from '../src/renderer/features/playback/application/playerKernelTransitions';

function snapshot(overrides: Partial<PlayerKernelSnapshot> = {}): PlayerKernelSnapshot {
  return {
    url: 'https://media.test/movie.mp4', progressKey: 'profile/source/movie', kernel: 'html5', preference: 'auto',
    allowMpv: true, mpvAvailable: true, live: false, nativeWindow: true, fullscreen: true,
    position: 60, paused: false, hasPlaybackError: false, htmlSettings: null, ...overrides,
  };
}

function pendingPorts() {
  let complete!: () => void;
  const exiting = new Promise<void>((resolve) => { complete = resolve; });
  const ports: PlayerKernelTransitionPorts = {
    window: { documentFullscreen: () => false, exitFullscreen: () => exiting },
    snapshot: () => snapshot(), releaseTemporaryRate: vi.fn(), clearAutoNext: vi.fn(), retryPluginEngine: vi.fn(),
    stageHandoff: vi.fn(), activateKernel: vi.fn(), rememberPreference: vi.fn(),
  };
  return { ports, complete, exiting };
}

afterEach(cleanup);

describe('usePlayerKernelTransitions lifecycle', () => {
  it('cancels a pending transition when the playback profile changes even if the URL is the same', async () => {
    const { ports, complete, exiting } = pendingPorts();
    const { result, rerender } = renderHook(({ resource }) => usePlayerKernelTransitions(resource.url, resource.progressKey, {
      ...ports, snapshot: () => resource,
    }), { initialProps: { resource: snapshot() } });
    act(() => { result.current.switchKernel('mpv'); });
    rerender({ resource: snapshot({ progressKey: 'another-profile/source/movie' }) });
    await act(async () => { complete(); await exiting; });
    expect(ports.stageHandoff).not.toHaveBeenCalled();
    expect(ports.activateKernel).not.toHaveBeenCalled();
    expect(ports.rememberPreference).not.toHaveBeenCalled();
  });

  it('ignores a pending window completion after the player unmounts', async () => {
    const { ports, complete, exiting } = pendingPorts();
    const { result, unmount } = renderHook(() => usePlayerKernelTransitions('url', 'scope', ports));
    act(() => { result.current.switchKernel('mpv'); });
    unmount();
    await act(async () => { complete(); await exiting; });
    expect(ports.activateKernel).not.toHaveBeenCalled();
    expect(ports.stageHandoff).not.toHaveBeenCalled();
  });

  it('uses the latest preference and callbacks without replacing the controller across renders', () => {
    const { ports } = pendingPorts();
    const oldStage = vi.fn();
    const newStage = vi.fn();
    const { result, rerender } = renderHook(({ resource, stage }) => usePlayerKernelTransitions(resource.url, resource.progressKey, {
      ...ports, snapshot: () => resource, stageHandoff: stage,
    }), {
      initialProps: { resource: snapshot({ preference: 'html5', fullscreen: false }), stage: oldStage },
      wrapper: StrictMode,
    });
    const firstController = result.current;
    act(() => { expect(result.current.recoverHtmlPlayback()).toBe(false); });
    rerender({ resource: snapshot({ preference: 'auto', fullscreen: false }), stage: newStage });
    act(() => { expect(result.current.recoverHtmlPlayback()).toBe(true); });
    expect(result.current).toBe(firstController);
    expect(oldStage).not.toHaveBeenCalled();
    expect(newStage).toHaveBeenCalledOnce();
  });
});

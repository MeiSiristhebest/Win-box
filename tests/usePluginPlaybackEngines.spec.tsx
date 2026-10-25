// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerEngineView } from '../src/shared/plugin';
import type { PluginPlaybackEnginesPort, PluginPlaybackEnginesSnapshot } from '../src/renderer/features/playback/application/pluginPlaybackEngines';
import { usePluginPlaybackEngines } from '../src/renderer/features/playback/usePluginPlaybackEngines';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function engine(id: string, label: string, ready = true): PlayerEngineView {
  return { id, pluginId: 'plugin', pluginName: 'Playback plugin', label, capabilities: [], ready };
}

function snapshot(engines: readonly PlayerEngineView[], enabledEngineIds: Record<string, boolean>): PluginPlaybackEnginesSnapshot {
  return { engines, enabledEngineIds };
}

let onChange: (() => void) | null = null;
const unsubscribe = vi.fn();
const port: PluginPlaybackEnginesPort = {
  loadSnapshot: vi.fn(async () => snapshot([], {})),
  subscribeToChanges: vi.fn(listener => {
    onChange = listener;
    return unsubscribe;
  }),
};

beforeEach(() => {
  vi.clearAllMocks();
  onChange = null;
  vi.mocked(port.loadSnapshot).mockResolvedValue(snapshot([], {}));
  vi.mocked(port.subscribeToChanges).mockImplementation(listener => {
    onChange = listener;
    return unsubscribe;
  });
});

describe('usePluginPlaybackEngines', () => {
  it('shows only ready and enabled plugin engines alongside the built-in choice', async () => {
    vi.mocked(port.loadSnapshot).mockResolvedValue(snapshot([
      engine('engine:ready', 'Ready'),
      engine('engine:disabled', 'Disabled'),
      engine('engine:missing', 'Missing', false),
      engine('html5', 'Invalid extension'),
    ], { 'engine:ready': true, 'engine:disabled': false, 'engine:missing': true }));
    const { result } = renderHook(() => usePluginPlaybackEngines(true, 'movie-url', null, port));

    await waitFor(() => expect(result.current.usable).toEqual(['engine:ready']));

    expect(result.current.choices.map(choice => choice.id)).toEqual(['html5', 'engine:ready']);
    expect(port.loadSnapshot).toHaveBeenCalledOnce();
  });

  it('refreshes when the adapter signals an engine or preference change and unsubscribes', async () => {
    vi.mocked(port.loadSnapshot)
      .mockResolvedValueOnce(snapshot([engine('engine:first', 'First')], { 'engine:first': true }))
      .mockResolvedValueOnce(snapshot([engine('engine:second', 'Second')], { 'engine:second': true }));
    const { result, unmount } = renderHook(() => usePluginPlaybackEngines(true, 'movie-url', null, port));
    await waitFor(() => expect(result.current.usable).toEqual(['engine:first']));

    await act(async () => { onChange?.(); });
    await waitFor(() => expect(result.current.usable).toEqual(['engine:second']));
    expect(port.loadSnapshot).toHaveBeenCalledTimes(2);
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('ignores a slower stale snapshot after a newer refresh completes', async () => {
    let finishFirst!: (value: PluginPlaybackEnginesSnapshot) => void;
    let finishSecond!: (value: PluginPlaybackEnginesSnapshot) => void;
    vi.mocked(port.loadSnapshot)
      .mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { finishSecond = resolve; }));
    const { result } = renderHook(() => usePluginPlaybackEngines(true, 'movie-url', null, port));

    act(() => { onChange?.(); });
    await act(async () => { finishSecond(snapshot([engine('engine:current', 'Current')], { 'engine:current': true })); await Promise.resolve(); });
    await act(async () => { finishFirst(snapshot([engine('engine:stale', 'Stale')], { 'engine:stale': true })); await Promise.resolve(); });

    expect(result.current.usable).toEqual(['engine:current']);
  });

  it('suppresses a failed engine for the current URL and resets that failure on retry', async () => {
    vi.mocked(port.loadSnapshot).mockResolvedValue(snapshot([engine('engine:ready', 'Ready')], { 'engine:ready': true }));
    const { result } = renderHook(() => usePluginPlaybackEngines(true, 'movie-url', null, port));
    await waitFor(() => expect(result.current.usable).toEqual(['engine:ready']));

    act(() => result.current.markFailure('engine:ready', 'failed to start'));
    expect(result.current.usable).toEqual([]);
    expect(result.current.notice).toContain('failed to start');
    act(() => result.current.retry());
    expect(result.current.usable).toEqual(['engine:ready']);
    expect(result.current.notice).toBe('');
  });
});

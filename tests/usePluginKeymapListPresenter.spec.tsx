// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { KeymapView } from '../src/shared/plugin';
import type { PluginKeymapListPort } from '../src/renderer/features/settings/application/settingsSectionPorts';
import { usePluginKeymapListPresenter } from '../src/renderer/features/settings/usePluginKeymapListPresenter';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('usePluginKeymapListPresenter', () => {
  it('derives the initial loading state and publishes the loaded snapshot', async () => {
    const pending = deferred<KeymapView[]>();
    const port: PluginKeymapListPort = { listKeymaps: vi.fn(() => pending.promise) };
    const { result } = renderHook(() => usePluginKeymapListPresenter(true, port));

    expect(result.current.model.status).toBe('loading');
    await act(async () => { pending.resolve([]); await pending.promise; });
    await waitFor(() => expect(result.current.model).toEqual({ status: 'ready', items: [] }));
  });

  it('ignores a pending snapshot after the view becomes inactive', async () => {
    const pending = deferred<KeymapView[]>();
    const port: PluginKeymapListPort = { listKeymaps: vi.fn(() => pending.promise) };
    const { result, rerender } = renderHook(
      ({ active }) => usePluginKeymapListPresenter(active, port),
      { initialProps: { active: true } },
    );

    act(() => rerender({ active: false }));
    await act(async () => { pending.resolve([]); await pending.promise; });

    expect(result.current.model).toEqual({ status: 'idle', items: [] });
  });
});

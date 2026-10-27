// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppMemorySessionPort } from '../src/renderer/features/appShell/application/appMemorySessionPort';
import { useAppMemorySession } from '../src/renderer/features/appShell/useAppMemorySession';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function createPort() {
  const listeners = new Map<string, ((value?: boolean) => void)[]>();
  const port: AppMemorySessionPort = {
    loadUiMemory: vi.fn(), saveUiMemory: vi.fn(), loadFavorites: vi.fn(),
    publishHistoryRefresh: vi.fn(), publishFavoritesRefresh: vi.fn(),
    subscribeBeforeUnload: vi.fn(listener => subscribe('unload', listener)),
    subscribePageHide: vi.fn(listener => subscribe('pagehide', listener)),
    subscribeVisibilityChange: vi.fn(listener => subscribe('visibility', listener)),
    subscribeWindowFocus: vi.fn(listener => subscribe('focus', listener)),
  };
  function subscribe(name: string, listener: (value?: boolean) => void): () => void {
    const bucket = listeners.get(name) ?? [];
    bucket.push(listener);
    listeners.set(name, bucket);
    return () => listeners.set(name, bucket.filter(item => item !== listener));
  }
  return {
    port,
    emit(name: string, value?: boolean) { for (const listener of listeners.get(name) ?? []) listener(value); },
    listenerCount(name: string) { return listeners.get(name)?.length ?? 0; },
  };
}

describe('app memory session', () => {
  it('loads at startup, saves on lifecycle events, refreshes shared data on focus, and releases listeners', () => {
    const fake = createPort();
    const view = renderHook(() => useAppMemorySession({ isPlayerWindow: false, port: fake.port }));
    expect(fake.port.loadUiMemory).toHaveBeenCalledOnce();
    expect(fake.port.loadFavorites).toHaveBeenCalledOnce();
    expect(fake.listenerCount('unload')).toBe(1);
    expect(fake.listenerCount('pagehide')).toBe(1);
    expect(fake.listenerCount('visibility')).toBe(1);
    expect(fake.listenerCount('focus')).toBe(1);

    act(() => fake.emit('focus'));
    expect(fake.port.loadUiMemory).toHaveBeenCalledTimes(2);
    expect(fake.port.publishHistoryRefresh).toHaveBeenCalledOnce();
    expect(fake.port.loadFavorites).toHaveBeenCalledTimes(2);
    expect(fake.port.publishFavoritesRefresh).toHaveBeenCalledOnce();
    act(() => fake.emit('visibility', true));
    expect(fake.port.saveUiMemory).toHaveBeenCalledOnce();
    act(() => fake.emit('visibility', false));
    expect(fake.port.loadUiMemory).toHaveBeenCalledTimes(3);

    view.unmount();
    expect(fake.listenerCount('unload')).toBe(0);
    expect(fake.listenerCount('pagehide')).toBe(0);
    expect(fake.listenerCount('visibility')).toBe(0);
    expect(fake.listenerCount('focus')).toBe(0);
    expect(fake.port.saveUiMemory).toHaveBeenCalledTimes(2);
  });

  it('does not reload shared data on focus or return-to-visible in the player window', () => {
    const fake = createPort();
    renderHook(() => useAppMemorySession({ isPlayerWindow: true, port: fake.port }));
    act(() => fake.emit('focus'));
    act(() => fake.emit('visibility', false));
    expect(fake.port.loadUiMemory).toHaveBeenCalledOnce();
    expect(fake.port.loadFavorites).toHaveBeenCalledOnce();
    expect(fake.listenerCount('focus')).toBe(0);
  });
});

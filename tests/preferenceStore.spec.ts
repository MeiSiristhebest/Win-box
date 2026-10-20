// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readPreference, subscribePreference, syncUiPreferencesFromMain, writePreference } from '../src/renderer/lib/preferenceStore';

afterEach(() => {
  localStorage.clear();
  Reflect.deleteProperty(window, 'api');
});

describe('renderer preference store', () => {
  it.each([
    ['netflix', 'dark'],
    ['bilibili', 'light'],
    ['apple', 'light'],
    ['douban', 'light'],
  ])('migrates the legacy %s theme to %s when initializing main preferences', async (legacyTheme, expectedTheme) => {
    vi.resetModules();
    localStorage.setItem('winbox-theme', legacyTheme);
    const initializeUiPreferences = vi.fn(async (patch: { themeId: string }) => ({
      ok: true as const,
      data: {
        revision: 1, initialized: true,
        values: { themeId: patch.themeId, motion: 'auto' as const, showDiscover: true, waterfall: false, homeFilters: false, navMode: 'inline' as const, posterSize: 'medium' as const },
      },
    }));
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { system: {
        onUiPreferencesChanged: () => () => undefined,
        getUiPreferences: async () => ({ ok: true, data: {
          revision: 0, initialized: false,
          values: { themeId: 'dark', motion: 'auto', showDiscover: true, waterfall: false, homeFilters: false, navMode: 'inline', posterSize: 'medium' },
        } }),
        initializeUiPreferences,
      } },
    });
    const { syncUiPreferencesFromMain: sync } = await import('../src/renderer/lib/preferenceStore');
    await sync();
    expect(initializeUiPreferences).toHaveBeenCalledWith(expect.objectContaining({ themeId: expectedTheme }));
  });

  it('notifies same-window subscribers only for their key and cleans listeners', () => {
    const themeListener = vi.fn();
    const motionListener = vi.fn();
    const unsubscribe = subscribePreference('theme', themeListener);
    const unsubscribeMotion = subscribePreference('motion', motionListener);

    writePreference('theme', 'apple');
    writePreference('motion', 'off');

    expect(readPreference('theme')).toBe('apple');
    expect(themeListener).toHaveBeenCalledTimes(1);
    expect(motionListener).toHaveBeenCalledTimes(1);
    unsubscribe();
    unsubscribeMotion();
    writePreference('theme', 'netflix');
    expect(themeListener).toHaveBeenCalledTimes(1);
  });

  it('notifies from another window storage events and storage clear', () => {
    const listener = vi.fn();
    const unsubscribe = subscribePreference('theme', listener);

    window.dispatchEvent(new StorageEvent('storage', { key: 'theme', newValue: 'douban' }));
    window.dispatchEvent(new StorageEvent('storage', { key: null }));

    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    window.dispatchEvent(new StorageEvent('storage', { key: 'theme', newValue: 'apple' }));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('subscribes before loading preferences and keeps a newer broadcast over a stale fetch response', async () => {
    type Snapshot = { revision: number; initialized: boolean; values: { themeId: string; motion: 'auto' | 'on' | 'off'; showDiscover: boolean; waterfall: boolean } };
    let receive: ((snapshot: Snapshot) => void) | undefined;
    const calls: string[] = [];
    const unsubscribeMain = vi.fn();
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        system: {
          onUiPreferencesChanged: (listener: typeof receive) => {
            calls.push('subscribe');
            receive = listener;
            return unsubscribeMain;
          },
          initializeUiPreferences: vi.fn(),
          getUiPreferences: async () => {
            calls.push('get');
            receive?.({
              revision: 2,
              initialized: true,
              values: { themeId: 'douban', motion: 'off', showDiscover: false, waterfall: true },
            });
            return {
              ok: true,
              data: { revision: 1, initialized: true, values: { themeId: 'apple', motion: 'on', showDiscover: true, waterfall: false } },
            };
          },
        },
      },
    });

    await syncUiPreferencesFromMain();

    expect(calls).toEqual(['subscribe', 'get']);
    expect(readPreference('winbox-theme')).toBe('light');
    expect(readPreference('winbox-motion')).toBe('off');
    expect(readPreference('winbox-show-discover')).toBe('0');
    expect(readPreference('winbox-waterfall')).toBe('1');
    expect(unsubscribeMain).not.toHaveBeenCalled();
    Reflect.deleteProperty(window, 'api');
  });

  it('applies the main-process snapshot to all cached preference keys and removes its IPC listener after the last subscriber', () => {
    let receive: ((snapshot: { revision: number; initialized: boolean; values: { themeId: string; motion: 'auto' | 'on' | 'off'; showDiscover: boolean; waterfall: boolean } }) => void) | undefined;
    const unsubscribeMain = vi.fn();
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { system: { onUiPreferencesChanged: (listener: typeof receive) => { receive = listener; return unsubscribeMain; } } },
    });
    const listener = vi.fn();
    const unsubscribe = subscribePreference('winbox-theme', listener);
    window.dispatchEvent(new StorageEvent('storage', { key: 'winbox-theme', newValue: 'douban' }));
    expect(listener).not.toHaveBeenCalled();

    receive?.({
      revision: 4,
      initialized: true,
      values: { themeId: 'dark', motion: 'off', showDiscover: false, waterfall: true },
    });

    expect(readPreference('winbox-theme')).toBe('dark');
    expect(readPreference('winbox-motion')).toBe('off');
    expect(readPreference('winbox-show-discover')).toBe('0');
    expect(readPreference('winbox-waterfall')).toBe('1');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(unsubscribeMain).toHaveBeenCalledOnce();
    window.dispatchEvent(new StorageEvent('storage', { key: 'winbox-theme', newValue: 'douban' }));
    expect(listener).toHaveBeenCalledTimes(1);
    Reflect.deleteProperty(window, 'api');
  });

  it('restores the last main-process snapshot when a durable update fails', async () => {
    const snapshot = {
      revision: 5,
      initialized: true,
      values: { themeId: 'douban', motion: 'auto' as const, showDiscover: true, waterfall: false },
    };
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        system: {
          onUiPreferencesChanged: () => () => undefined,
          initializeUiPreferences: vi.fn(),
          getUiPreferences: async () => ({ ok: true, data: snapshot }),
          updateUiPreferences: async () => ({
            ok: false,
            error: { code: 'IO', message: 'disk unavailable' },
          }),
        },
      },
    });

    await syncUiPreferencesFromMain();
    writePreference('winbox-theme', 'apple');
    expect(readPreference('winbox-theme')).toBe('light');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(readPreference('winbox-theme')).toBe('light');
  });
});

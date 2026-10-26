// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => { localStorage.clear(); vi.resetModules(); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('renderer backup replacement', () => {
  it('unload and pending progress writes cannot overwrite restored history or progress', async () => {
    vi.useFakeTimers();
    const old = await import('../src/renderer/lib/uiMemory');
    old.recordWatch({ url: 'https://old.test/video', name: 'old', time: 500 });
    old.uiMem.playTime.set('https://old.test/video', 500);
    old.schedulePersist();
    const epoch = await import('../src/renderer/lib/storageEpoch');
    const backup = JSON.stringify({ history: [['new', { name: 'restored', url: 'new', time: 8, updatedAt: 1 }]], playTime: [['new', 8]], deleted: [], detail: [] });
    epoch.prepareRendererBackupRestore({ tvboxUiMemory: backup });
    old.saveUiMemory();
    await vi.advanceTimersByTimeAsync(3000);
    expect(localStorage.getItem('tvboxUiMemory')).toBe(backup);
    vi.resetModules();
    const reloaded = await import('../src/renderer/lib/uiMemory');
    reloaded.loadUiMemory();
    expect([...reloaded.uiMem.playTime]).toEqual([['new', 8]]);
    expect([...reloaded.uiMem.history.values()].map(item => item.name)).toEqual(['restored']);
  });

  it('removes keys absent from the backup and blocks old favorites writers', async () => {
  const favorites = await import('../src/renderer/features/favorites/favoritesRuntime');
    favorites.addFavorite({ sourceKey: 'a', vodId: 'old', name: 'old' });
    const { prepareRendererBackupRestore, STORAGE_EPOCH_KEY } = await import('../src/renderer/lib/storageEpoch');
    prepareRendererBackupRestore({ 'winbox-theme': 'apple' });
    favorites.addFavorite({ sourceKey: 'a', vodId: 'stale', name: 'stale' });
    expect(localStorage.getItem('winbox-favorites')).toBeNull();
    expect(localStorage.getItem('winbox-theme')).toBe('apple');
    expect(localStorage.getItem(STORAGE_EPOCH_KEY)).toBeTruthy();
  });

  it('rolls storage back when the main-process commit fails', async () => {
    const ui = await import('../src/renderer/lib/uiMemory');
    ui.recordWatch({ url: 'old', name: 'old' });
    ui.saveUiMemory();
    const before = localStorage.getItem('tvboxUiMemory');
    const epoch = await import('../src/renderer/lib/storageEpoch');
    const transaction = epoch.prepareRendererBackupRestore({ 'winbox-theme': 'apple' });
    transaction.rollback();
    expect(localStorage.getItem('tvboxUiMemory')).toBe(before);
    expect(localStorage.getItem('winbox-theme')).toBeNull();
    expect(epoch.canWriteRendererStorage()).toBe(true);
  });

  it('rolls partial writes back after a quota error', async () => {
    const epoch = await import('../src/renderer/lib/storageEpoch');
    localStorage.setItem('original', 'saved');
    const original = localStorage.setItem.bind(localStorage);
    vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      if (key === 'fail') throw new Error('quota');
      original(key, value);
    });
    expect(() => epoch.prepareRendererBackupRestore({ partial: 'written', fail: 'value' })).toThrow('quota');
    expect(localStorage.getItem('original')).toBe('saved');
    expect(localStorage.getItem('partial')).toBeNull();
    expect(epoch.canWriteRendererStorage()).toBe(true);
  });
});

// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { HomePageMemorySnapshot } from '../src/renderer/features/home/application/homePageMemoryPort';
import { useHomePageMemorySession } from '../src/renderer/features/home/useHomePageMemorySession';

describe('useHomePageMemorySession', () => {
  it('restores scroll, exposes the back-to-top action, and persists one complete snapshot on unmount', () => {
    let snapshot: HomePageMemorySnapshot = {
      key: 'source-a', profileId: 'profile-a', tid: 'category-a', pg: 2,
      scrollTop: 340, filters: { year: '2026' }, search: null,
    };
    const memory = {
      read: vi.fn(() => snapshot),
      update: vi.fn((patch: Partial<HomePageMemorySnapshot>) => { snapshot = { ...snapshot, ...patch }; }),
      persist: vi.fn(),
    };
    const element = document.createElement('div');
    const scrollTo = vi.fn();
    Object.defineProperty(element, 'scrollTo', { configurable: true, value: scrollTo });
    const contentRef = { current: element };
    const keyRef = { current: 'source-b' };
    const profileIdRef = { current: 'profile-b' };
    const restorePendingRef = { current: true };
    const options = {
      contentRef,
      memory,
      keyRef,
      profileIdRef,
      restorePendingRef,
      items: [],
      loading: false,
      categoryId: 'category-b',
      page: 4,
      filters: { year: '2025' },
      waterfall: true,
      aggregateMode: false,
    };

    const { result, unmount } = renderHook(() => useHomePageMemorySession(options));
    expect(element.scrollTop).toBe(340);
    expect(restorePendingRef.current).toBe(false);

    act(() => {
      element.scrollTop = 700;
      element.dispatchEvent(new Event('scroll'));
    });
    expect(result.current.backToTop.visible).toBe(true);
    act(() => result.current.backToTop.onClick());
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });

    unmount();
    expect(memory.persist).toHaveBeenCalledOnce();
    expect(memory.update).toHaveBeenLastCalledWith({
      scrollTop: 700,
      key: 'source-b',
      profileId: 'profile-b',
      tid: 'category-b',
      pg: 4,
      filters: { year: '2025' },
    });
  });
});

// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SourceBean, VodItem } from '../src/shared/types';
import { useHomeItemNavigationPresenter, type HomeItemNavigationPresenterOptions } from '../src/renderer/features/home/useHomeItemNavigationPresenter';

afterEach(cleanup);

function source(key: string): SourceBean {
  return {
    key, name: key, type: 1, api: 'https://api.test', searchable: 1, quickSearch: 1,
    changeable: 1, filterable: 1, playUrl: '', ext: '', jar: '', playerType: -1,
    categories: null, timeout: 15, click: '', style: '',
  };
}

function item(): VodItem {
  return {
    id: 'movie-1', name: '示例电影', pic: 'https://image.test/poster.jpg', remarks: '',
    year: '2025', area: '', type: '电影', sourceKey: 'source-a',
  };
}

describe('useHomeItemNavigationPresenter', () => {
  it('keeps card callbacks stable while dispatching with the latest page context', async () => {
    const oldOpenDetail = vi.fn();
    const currentOpenDetail = vi.fn();
    const options: HomeItemNavigationPresenterOptions = {
      currentProfileId: 'profile-a',
      currentSources: [source('source-a')],
      currentSite: source('source-a'),
      fallbackSourceKey: 'source-a',
      sourceLookup: { loadProfileSources: vi.fn(async () => []) },
      navigate: vi.fn(),
      openFolder: vi.fn(),
      onOpenDetail: oldOpenDetail,
    };
    const { result, rerender } = renderHook(
      (currentOptions: HomeItemNavigationPresenterOptions) => useHomeItemNavigationPresenter(currentOptions),
      { initialProps: options },
    );
    const stableCallback = result.current.openBrowseItem;

    rerender({ ...options, currentProfileId: 'profile-b', onOpenDetail: currentOpenDetail });
    expect(result.current.openBrowseItem).toBe(stableCallback);

    await act(async () => {
      result.current.openBrowseItem(item());
    });

    expect(oldOpenDetail).not.toHaveBeenCalled();
    expect(currentOpenDetail).toHaveBeenCalledWith(
      'source-a', 'movie-1', 'https://image.test/poster.jpg', '示例电影', 'profile-b',
    );
  });
});

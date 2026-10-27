// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DetailFavoriteMetadata, DetailFavoriteMetadataPort } from '../src/renderer/features/detail/application/detailFavoriteMetadata';
import { useDetailFavoriteMetadata } from '../src/renderer/features/detail/useDetailFavoriteMetadata';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

describe('useDetailFavoriteMetadata', () => {
  it('hides stale metadata while a new source lookup is pending', async () => {
    const oldResult = deferred<DetailFavoriteMetadata>();
    const currentResult = deferred<DetailFavoriteMetadata>();
    const load = vi.fn<DetailFavoriteMetadataPort['load']>()
      .mockReturnValueOnce(oldResult.promise)
      .mockReturnValueOnce(currentResult.promise);
    const port: DetailFavoriteMetadataPort = { load };
    const { result, rerender } = renderHook(
      ({ sourceKey, profileId }) => useDetailFavoriteMetadata(sourceKey, profileId, port),
      { initialProps: { sourceKey: 'source-a', profileId: 'profile-a' } },
    );

    expect(result.current).toEqual({ profileId: '', sourceName: '' });
    rerender({ sourceKey: 'source-b', profileId: 'profile-b' });
    expect(result.current).toEqual({ profileId: '', sourceName: '' });

    await act(async () => {
      oldResult.resolve({ profileId: 'profile-a', sourceName: 'Old source' });
      await oldResult.promise;
    });
    expect(result.current).toEqual({ profileId: '', sourceName: '' });

    await act(async () => {
      currentResult.resolve({ profileId: 'profile-b', sourceName: 'Current source' });
      await currentResult.promise;
    });
    expect(result.current).toEqual({ profileId: 'profile-b', sourceName: 'Current source' });
  });
});

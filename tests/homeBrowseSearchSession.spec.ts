import { describe, expect, it } from 'vitest';
import { createHomeBrowseSearchSession, type HomeBrowseSnapshot } from '../src/renderer/features/home/application/homeBrowseSearchSession';
import type { VodItem } from '../src/shared/types';

function createSnapshot(key = 'source-a'): HomeBrowseSnapshot {
  return {
    key,
    items: [{ id: 'movie-1', name: 'Movie' } as VodItem],
    classes: [],
    pageInfo: { page: 1, pagecount: 4, total: 12 },
    pg: 1,
    tid: 'drama',
    filters: { year: '2026' },
    fallback: false,
  };
}

describe('HomeBrowseSearchSession', () => {
  it('restores the saved browse state once when returning to the same source', () => {
    const activeSourceKey = 'source-a';
    const snapshot = createSnapshot();
    const session = createHomeBrowseSearchSession({
      activeProfileId: () => 'profile-a',
      setActiveProfileId: () => undefined,
      activeSourceKey: () => activeSourceKey,
      invalidateBrowseRequests: () => undefined,
      currentSnapshot: () => snapshot,
    });

    session.port.preserveBrowseForSearch(false);

    expect(session.port.returnDestination()).toEqual({ kind: 'restore', snapshot });
    expect(session.port.returnDestination()).toEqual({ kind: 'reload', sourceKey: 'source-a' });
  });

  it('does not preserve an aggregate search result list or restore across a source change', () => {
    let activeSourceKey = 'source-a';
    const snapshot = createSnapshot();
    const session = createHomeBrowseSearchSession({
      activeProfileId: () => 'profile-a',
      setActiveProfileId: () => undefined,
      activeSourceKey: () => activeSourceKey,
      invalidateBrowseRequests: () => undefined,
      currentSnapshot: () => snapshot,
    });

    session.port.preserveBrowseForSearch(true);
    expect(session.port.returnDestination()).toEqual({ kind: 'reload', sourceKey: 'source-a' });

    session.port.preserveBrowseForSearch(false);
    activeSourceKey = 'source-b';
    expect(session.port.returnDestination()).toEqual({ kind: 'reload', sourceKey: 'source-b' });
  });

  it('clears a stale browse snapshot when a new browse operation starts', () => {
    const snapshot = createSnapshot();
    const session = createHomeBrowseSearchSession({
      activeProfileId: () => 'profile-a',
      setActiveProfileId: () => undefined,
      activeSourceKey: () => 'source-a',
      invalidateBrowseRequests: () => undefined,
      currentSnapshot: () => snapshot,
    });

    session.port.preserveBrowseForSearch(false);
    session.browseStarted();

    expect(session.port.returnDestination()).toEqual({ kind: 'reload', sourceKey: 'source-a' });
  });
});

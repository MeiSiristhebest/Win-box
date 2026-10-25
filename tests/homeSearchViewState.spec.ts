import { describe, expect, it } from 'vitest';
import type { SearchAllReport } from '../src/shared/types';
import type { HomeSearchMem } from '../src/renderer/features/home/application/HomeSearchMemory';
import {
  initialHomeSearchViewState,
  reduceHomeSearchViewState,
} from '../src/renderer/features/home/application/homeSearchViewState';

const report: SearchAllReport = {
  items: [],
  perSource: [],
  hitSources: 0,
  failedSources: 0,
  totalRaw: 0,
};

describe('home search presentation model', () => {
  it('starts aggregate searches with a clean page while retaining independent match preferences', () => {
    const current = {
      ...initialHomeSearchViewState,
      report,
      progress: { done: 2, total: 5, pending: 3 },
      visibleLimit: 120,
      sourceFilter: 'source-a',
      profileFilter: 'profile-a',
      matchMode: 'all' as const,
    };

    expect(reduceHomeSearchViewState(current, {
      type: 'search-started', scope: 'all-profiles', aggregate: true,
    })).toMatchObject({
      aggregateMode: true,
      scope: 'all-profiles',
      searchAllSources: true,
      report: null,
      progress: null,
      visibleLimit: 60,
      sourceFilter: '',
      profileFilter: 'profile-a',
      matchMode: 'all',
    });
  });

  it('restores remembered folder identity using the remembered profile before the active fallback', () => {
    const memory: HomeSearchMem = {
      wd: 'show',
      profileId: 'profile-a',
      aggMode: true,
      aggScope: 'all',
      searchAllSources: true,
      agg: report,
      folder: { key: 'source-a', tid: 'folder-1', name: 'Cloud', profileId: 'profile-a', sourceName: 'Drive' },
    };

    expect(reduceHomeSearchViewState(initialHomeSearchViewState, {
      type: 'search-memory-restored', memory, defaultProfileId: 'profile-b',
    })).toMatchObject({
      term: 'show', aggregateMode: true, report, scope: 'all',
      folder: { key: 'source-a', tid: 'folder-1', profileId: 'profile-a' },
    });
  });

  it('clears the source filter when profile or match selection changes and applies the default card cap', () => {
    const current = { ...initialHomeSearchViewState, sourceFilter: 'source-a', visibleLimit: 180 };
    const afterProfile = reduceHomeSearchViewState(current, { type: 'profile-filter-selected', profileId: 'profile-b' });
    const afterMode = reduceHomeSearchViewState(afterProfile, { type: 'match-mode-selected', mode: 'all' });

    expect(afterProfile).toMatchObject({ profileFilter: 'profile-b', sourceFilter: '', visibleLimit: 60 });
    expect(afterMode).toMatchObject({ matchMode: 'all', visibleLimit: 60 });
  });

  it('restores the prior query after leaving a folder only when the profile snapshot still matches', () => {
    const memory: HomeSearchMem = {
      wd: 'show', profileId: 'profile-a', aggMode: true, aggScope: 'all',
      searchAllSources: true, agg: report, folder: null,
    };
    const restored = reduceHomeSearchViewState({ ...initialHomeSearchViewState, folder: {
      key: 'source-a', tid: 'folder-1', name: 'Cloud', profileId: 'profile-a',
    } }, {
      type: 'folder-exited', transition: {
        kind: 'restored', memory, report, scope: 'all', sourceFilter: 'source-a',
        searchAllSources: true, searchAllProfiles: false,
      },
    });

    expect(restored).toMatchObject({ folder: null, report, scope: 'all', sourceFilter: 'source-a', visibleLimit: 60 });
    expect(reduceHomeSearchViewState(restored, {
      type: 'folder-exited', transition: { kind: 'search-again' },
    })).toMatchObject({ folder: null, report: null, scope: 'all' });
  });
});

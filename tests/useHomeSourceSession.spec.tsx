// @vitest-environment happy-dom
import * as React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SourceBean, UserConfig } from '../src/shared/types';
import { makeStaleGuard } from '../src/renderer/lib/staleGuard';
import { useHomeSourceSession } from '../src/renderer/features/home/useHomeSourceSession';
import type { HomePageMemoryPort } from '../src/renderer/features/home/application/homePageMemoryPort';
import type { HomeBrowseSessionPort, HomeSourceSessionEvent, HomeSourceSessionEventsPort, HomeSourceSelectionPort } from '../src/renderer/features/home/application/homePorts';

type SessionRoute = {
  requestedProfileId: string;
  pathname: string;
  aggParam: string;
  requestedAllProfiles: boolean;
  pageActive: boolean;
};

type EventListenerCell = { listener?: (event: HomeSourceSessionEvent) => void };

const source = { key: 'source-a', name: 'Source A', type: 1, api: 'https://source.invalid/api' } as SourceBean;
const configuration = {
  sources: [source],
  profiles: [{ id: 'profile-a', name: 'Profile A' }],
  activeProfileId: 'profile-a',
  ui: { activeSourceKey: source.key },
} as unknown as UserConfig;

function useSessionHarness(
  route: SessionRoute,
  sourceSelection: HomeSourceSelectionPort,
  listenerCell: EventListenerCell,
) {
  const [sites, setSites] = React.useState<SourceBean[]>([]);
  const [profiles, setProfiles] = React.useState<Array<{ id: string; name: string }>>([]);
  const [activeProfileId, setActiveProfileId] = React.useState('');
  const [profileReady, setProfileReady] = React.useState(false);
  const [key, setKey] = React.useState('');
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const profileIdRef = React.useRef('');
  const keyRef = React.useRef('');
  const listGen = React.useRef(makeStaleGuard());
  const [cancelPendingSearch] = React.useState(() => vi.fn());
  const memory: HomePageMemoryPort = {
    read: () => ({ profileId: 'profile-a', key: source.key, tid: '', pg: 1, scrollTop: 0, filters: {}, search: null }),
    update: vi.fn(),
    persist: vi.fn(),
  };
  const events: HomeSourceSessionEventsPort = {
    subscribe: (listener) => {
      listenerCell.listener = listener;
      return vi.fn();
    },
  };
  const browse: HomeBrowseSessionPort = {
    activeSourceKey: () => keyRef.current,
    selectSource: (sourceKey) => { keyRef.current = sourceKey; setKey(sourceKey); },
    invalidateRequests: () => { listGen.current.next(); },
    clear: (message = '') => { keyRef.current = ''; setKey(''); setError(message); setLoading(false); },
    loadHome: vi.fn(async (sourceKey: string): Promise<void> => { keyRef.current = sourceKey; setKey(sourceKey); }),
    restoreCategory: vi.fn(async (): Promise<void> => undefined),
  };

  useHomeSourceSession({
    route,
    actions: {
      profileIdRef,
      setProfileId: setActiveProfileId,
      setSites, setProfiles, setProfileReady, setSourceError: setError,
      clearWorkflowLoading: () => setLoading(false),
      dispatchSearch: vi.fn(), applySearchMem: vi.fn(), doSearch: vi.fn(), cancelPendingSearch,
    },
    ports: {
      sourceSelection,
      events,
      browse,
      memory,
    },
  });

  return { sites, profiles, activeProfileId, profileReady, key, error, loading, setLoading, listGen, cancelPendingSearch };
}

function sourceSelection(loadConfiguration: HomeSourceSelectionPort['loadConfiguration']): HomeSourceSelectionPort {
  return {
    loadConfiguration,
    loadProfileSources: vi.fn(async () => [source]),
  };
}

describe('useHomeSourceSession', () => {
  it('releases loading when a source-bound request is invalidated and config refresh fails', async () => {
    const events: EventListenerCell = {};
    const loadConfiguration = vi.fn()
      .mockResolvedValueOnce(configuration)
      .mockRejectedValueOnce(new Error('configuration refresh failed'));
    const { result } = renderHook(() => useSessionHarness(
      { requestedProfileId: '', pathname: '/home', aggParam: '', requestedAllProfiles: false, pageActive: true },
      sourceSelection(loadConfiguration),
      events,
    ));

    await waitFor(() => expect(result.current.profileReady).toBe(true));
    expect(result.current.activeProfileId).toBe('profile-a');
    let activeBrowse!: number;
    act(() => {
      result.current.setLoading(true);
      activeBrowse = result.current.listGen.current.next();
      events.listener?.({ type: 'source-changed', sourceKey: 'source-b' });
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.listGen.current.isCurrent(activeBrowse)).toBe(false);
    expect(result.current.cancelPendingSearch).toHaveBeenCalledOnce();
    await waitFor(() => expect(result.current.error).toBe('configuration refresh failed'));
  });

  it('uses the latest route when deciding whether a cross-profile search remains active', async () => {
    const events: EventListenerCell = {};
    const loadConfiguration = vi.fn().mockResolvedValue(configuration);
    const { result, rerender } = renderHook(
      ({ route }) => useSessionHarness(route, sourceSelection(loadConfiguration), events),
      { initialProps: { route: { requestedProfileId: '', pathname: '/home', aggParam: '', requestedAllProfiles: false, pageActive: true } } },
    );

    await waitFor(() => expect(result.current.profileReady).toBe(true));
    rerender({ route: { requestedProfileId: '', pathname: '/search', aggParam: 'title', requestedAllProfiles: true, pageActive: true } });

    act(() => {
      result.current.setLoading(true);
      events.listener?.({ type: 'source-changed', sourceKey: 'source-b' });
    });

    expect(result.current.loading).toBe(true);
    expect(result.current.cancelPendingSearch).not.toHaveBeenCalled();
    await waitFor(() => expect(loadConfiguration).toHaveBeenCalledTimes(2));
  });
});

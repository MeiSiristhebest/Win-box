// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DiscoverSection } from '../src/shared/types';
import type { DiscoverBoardDirectoryPort } from '../src/renderer/features/discovery/application/discoveryPorts';
import { useBoardDirectoryPresenter } from '../src/renderer/features/discovery/useBoardDirectoryPresenter';

const section: DiscoverSection = { id: 'popular', title: '热门', items: [] };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function createPort(overrides: Partial<DiscoverBoardDirectoryPort> = {}): DiscoverBoardDirectoryPort {
  return {
    loadSections: vi.fn().mockResolvedValue([section]),
    hasTmdbCredentials: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}

describe('useBoardDirectoryPresenter', () => {
  it('surfaces a board-feed failure and retries without losing independently loaded credentials', async () => {
    const port = createPort({
      loadSections: vi.fn().mockRejectedValueOnce(new Error('recommendation service unavailable')).mockResolvedValueOnce([section]),
    });
    const { result } = renderHook(() => useBoardDirectoryPresenter(port, true));

    await waitFor(() => expect(result.current.sectionsStatus).toBe('failed'));
    expect(result.current.sectionsError).toBe('recommendation service unavailable');
    expect(result.current.credentialsStatus).toBe('ready');
    expect(result.current.hasTmdbCredentials).toBe(false);

    await act(async () => { await result.current.retry(); });
    expect(result.current.sectionsStatus).toBe('ready');
    expect(result.current.sections).toEqual([section]);
  });

  it('does not turn a credential lookup failure into a claim that no key is configured', async () => {
    const port = createPort({ hasTmdbCredentials: vi.fn().mockRejectedValue(new Error('settings unavailable')) });
    const { result } = renderHook(() => useBoardDirectoryPresenter(port, true));

    await waitFor(() => expect(result.current.credentialsStatus).toBe('failed'));
    expect(result.current.hasTmdbCredentials).toBeNull();
    expect(result.current.credentialsError).toBe('settings unavailable');
  });

  it('publishes a credentials result while the board feed is still pending', async () => {
    const sections = deferred<DiscoverSection[]>();
    const port = createPort({
      loadSections: vi.fn(() => sections.promise),
      hasTmdbCredentials: vi.fn().mockResolvedValue(true),
    });
    const { result } = renderHook(() => useBoardDirectoryPresenter(port, true));

    await waitFor(() => expect(result.current.credentialsStatus).toBe('ready'));
    expect(result.current.hasTmdbCredentials).toBe(true);
    expect(result.current.sectionsStatus).toBe('loading');

    await act(async () => { sections.resolve([section]); });
    await waitFor(() => expect(result.current.sectionsStatus).toBe('ready'));
  });

  it('allows retrying a failed board feed while credentials are still loading', async () => {
    const credentials = deferred<boolean>();
    const loadSections = vi.fn().mockRejectedValueOnce(new Error('feed unavailable')).mockResolvedValueOnce([section]);
    const hasTmdbCredentials = vi.fn(() => credentials.promise);
    const port = createPort({ loadSections, hasTmdbCredentials });
    const { result } = renderHook(() => useBoardDirectoryPresenter(port, true));

    await waitFor(() => expect(result.current.sectionsStatus).toBe('failed'));
    expect(result.current.credentialsStatus).toBe('loading');

    await act(async () => { await result.current.retrySections(); });
    expect(result.current.sectionsStatus).toBe('ready');
    expect(result.current.sections).toEqual([section]);
    expect(result.current.credentialsStatus).toBe('loading');
    expect(hasTmdbCredentials).toHaveBeenCalledTimes(1);

    await act(async () => { credentials.resolve(false); });
  });

  it('allows retrying credentials while the board feed is still loading', async () => {
    const sections = deferred<DiscoverSection[]>();
    const loadSections = vi.fn(() => sections.promise);
    const hasTmdbCredentials = vi.fn().mockRejectedValueOnce(new Error('settings unavailable')).mockResolvedValueOnce(true);
    const port = createPort({ loadSections, hasTmdbCredentials });
    const { result } = renderHook(() => useBoardDirectoryPresenter(port, true));

    await waitFor(() => expect(result.current.credentialsStatus).toBe('failed'));
    expect(result.current.sectionsStatus).toBe('loading');

    await act(async () => { await result.current.retryCredentials(); });
    expect(result.current.credentialsStatus).toBe('ready');
    expect(result.current.hasTmdbCredentials).toBe(true);
    expect(result.current.sectionsStatus).toBe('loading');
    expect(loadSections).toHaveBeenCalledOnce();

    await act(async () => { sections.resolve([section]); });
  });

  it('ignores an older board-feed request when a newer retry completes first', async () => {
    const stale = deferred<DiscoverSection[]>();
    const newerSection = { ...section, id: 'newer', title: '最新' };
    const port = createPort({
      loadSections: vi.fn().mockImplementationOnce(() => stale.promise).mockResolvedValueOnce([newerSection]),
    });
    const { result } = renderHook(() => useBoardDirectoryPresenter(port, true));

    await waitFor(() => expect(port.loadSections).toHaveBeenCalledOnce());
    await act(async () => { await result.current.retrySections(); });
    expect(result.current.sections).toEqual([newerSection]);

    await act(async () => { stale.resolve([section]); });
    expect(result.current.sections).toEqual([newerSection]);
  });

  it('ignores a result from a page that became inactive before the request completed', async () => {
    let resolveSections!: (sections: DiscoverSection[]) => void;
    const port = createPort({ loadSections: vi.fn(() => new Promise<DiscoverSection[]>((resolve) => { resolveSections = resolve; })) });
    const { result, rerender } = renderHook(({ active }) => useBoardDirectoryPresenter(port, active), { initialProps: { active: true } });

    await waitFor(() => expect(port.loadSections).toHaveBeenCalledOnce());
    rerender({ active: false });
    await act(async () => { resolveSections([section]); });

    expect(result.current.sections).toEqual([]);
  });
});

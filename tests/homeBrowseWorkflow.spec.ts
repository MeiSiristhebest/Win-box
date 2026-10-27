import { describe, expect, it, vi } from 'vitest';
import { HomeBrowseWorkflow } from '../src/renderer/features/home/application/HomeBrowseWorkflow';
import type { HomeBrowseContextPort } from '../src/renderer/features/home/application/HomeBrowseWorkflow';
import type { HomeBrowsePort, HomeCategoryStateMemoryPort } from '../src/renderer/features/home/application/homePorts';
import type { VodItem } from '../src/shared/types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function result(sourceKey: string, ids: string | string[], page = 1) {
  const items: VodItem[] = (Array.isArray(ids) ? ids : [ids]).map((id) => ({
    id, name: id, pic: '', remarks: '', year: '', area: '', type: '', sourceKey,
  }));
  return { sourceKey, sortClasses: [], items, page, pagecount: 4, total: 16 };
}

function createHarness(data: HomeBrowsePort, categoryState: HomeCategoryStateMemoryPort = { read: () => undefined, save: () => undefined }) {
  let sourceKey = 'source-a';
  let profileId = 'profile-a';
  const context: HomeBrowseContextPort = {
    activeSourceKey: () => sourceKey,
    selectSource: (next) => { sourceKey = next; },
    activeProfileId: () => profileId,
    setActiveProfileId: (next) => { profileId = next; },
  };
  const browseStarted = vi.fn();
  const memoryRestoreStarted = vi.fn();
  const workflow = new HomeBrowseWorkflow({ data, context, categoryState, browseStarted, memoryRestoreStarted }, {
    aggregateMode: false,
    waterfall: false,
  });
  workflow.activate();
  return { workflow, context, browseStarted, memoryRestoreStarted };
}

describe('HomeBrowseWorkflow', () => {
  it('owns source switching and discards late home results without React state', async () => {
    const staleRequest = deferred<ReturnType<typeof result>>();
    const home = vi.fn()
      .mockReturnValueOnce(staleRequest.promise)
      .mockResolvedValueOnce(result('source-b', 'current'));
    const { workflow, context } = createHarness({ home, category: vi.fn() });

    const stale = workflow.loadHome('source-a');
    const current = workflow.loadHome('source-b');
    expect(context.activeSourceKey()).toBe('source-b');
    expect(home.mock.calls[0]?.[2]?.aborted).toBe(true);
    await current;
    staleRequest.resolve(result('source-a', 'stale'));
    await stale;

    expect(workflow.getSnapshot().items.map((item) => item.id)).toEqual(['current']);
    expect(workflow.getSnapshot().loading).toBe(false);
    workflow.dispose();
  });

  it('discards late category results after a newer category request without React state', async () => {
    const staleRequest = deferred<ReturnType<typeof result>>();
    const category = vi.fn()
      .mockReturnValueOnce(staleRequest.promise)
      .mockResolvedValueOnce(result('source-a', 'current', 1));
    const { workflow } = createHarness({ home: vi.fn(), category });

    const stale = workflow.loadCategory('genre', 3, { area: 'east' });
    const current = workflow.loadCategory('genre', 1, { area: 'west' });
    expect(category.mock.calls[0]?.[1]?.aborted).toBe(true);
    await current;
    staleRequest.resolve(result('source-a', 'stale', 3));
    await stale;

    expect(workflow.getSnapshot()).toMatchObject({
      items: [expect.objectContaining({ id: 'current' })],
      pg: 1,
      loading: false,
      error: '',
    });
    workflow.dispose();
  });

  it('invalidates category work when the active source changes', async () => {
    const staleRequest = deferred<ReturnType<typeof result>>();
    const category = vi.fn()
      .mockReturnValueOnce(staleRequest.promise)
      .mockResolvedValueOnce(result('source-b', 'source-b-item', 1));
    const { workflow } = createHarness({ home: vi.fn(), category });

    const stale = workflow.loadCategory('genre', 2);
    workflow.sessionPort.selectSource('source-b');
    const current = workflow.loadCategory('genre', 1);
    expect(category.mock.calls[0]?.[1]?.aborted).toBe(true);
    await current;
    staleRequest.resolve(result('source-a', 'stale-source-item', 2));
    await stale;

    expect(workflow.getSnapshot().items.map((item) => item.id)).toEqual(['source-b-item']);
    workflow.dispose();
  });

  it('stores filter and page selections through the category memory port', async () => {
    const categoryState: HomeCategoryStateMemoryPort = {
      read: vi.fn(() => ({ filters: { area: 'east' }, page: 3 })),
      save: vi.fn(),
    };
    const category = vi.fn().mockResolvedValue(result('source-a', 'page-three', 3));
    const { workflow } = createHarness({ home: vi.fn(), category }, categoryState);

    workflow.chooseCategory('genre');
    await vi.waitFor(() => expect(workflow.getSnapshot().pg).toBe(3));
    expect(category).toHaveBeenCalledWith({
      key: 'source-a', tid: 'genre', pg: '3', extend: { area: 'east' }, profileId: 'profile-a',
    }, expect.any(AbortSignal));

    workflow.chooseFilter('area', 'west');
    expect(categoryState.save).toHaveBeenLastCalledWith('source-a', 'genre', 'profile-a', {
      filters: { area: 'west' }, page: 1,
    });
    workflow.dispose();
  });

  it('preserves and restores browse snapshots without rereading the source', async () => {
    const home = vi.fn().mockResolvedValue(result('source-a', 'saved'));
    const { workflow } = createHarness({ home, category: vi.fn() });
    await workflow.loadHome('source-a');
    workflow.searchBrowsePort.preserveBrowseForSearch(false);
    const destination = workflow.searchBrowsePort.returnDestination();
    expect(destination.kind).toBe('restore');
    if (destination.kind !== 'restore') throw new Error('expected browse snapshot');

    workflow.clearResults();
    workflow.restoreSnapshot(destination.snapshot);
    expect(workflow.getSnapshot().items.map((item) => item.id)).toEqual(['saved']);
    expect(home).toHaveBeenCalledTimes(1);
    workflow.dispose();
  });

  it('publishes loading and error transitions to independent subscribers', async () => {
    const home = vi.fn().mockRejectedValue(new Error('source unavailable'));
    const { workflow } = createHarness({ home, category: vi.fn() });
    const listener = vi.fn();
    const unsubscribe = workflow.subscribe(listener);

    await workflow.loadHome('source-a');

    expect(workflow.getSnapshot()).toMatchObject({ loading: false, error: 'source unavailable', items: [] });
    expect(listener).toHaveBeenCalled();
    unsubscribe();
    workflow.dispose();
  });

  it('stops waterfall paging when a reordered duplicate page adds no new items', async () => {
    const category = vi.fn()
      .mockResolvedValueOnce({ ...result('source-a', ['first', 'second']), page: 1, pagecount: 3 })
      .mockResolvedValueOnce({ ...result('source-a', ['second', 'first']), page: 2, pagecount: 3 });
    const { workflow } = createHarness({ home: vi.fn(), category });
    workflow.updateOptions({ aggregateMode: false, waterfall: true });
    workflow.chooseCategory('genre');
    await vi.waitFor(() => expect(workflow.getSnapshot().loading).toBe(false));

    workflow.loadMoreForWaterfall();
    await vi.waitFor(() => expect(workflow.getSnapshot().pg).toBe(2));

    expect(workflow.getSnapshot().wfNoMore).toBe(true);
    expect(workflow.getSnapshot().items).toHaveLength(2);
    workflow.loadMoreForWaterfall();
    expect(category).toHaveBeenCalledTimes(2);
    workflow.dispose();
  });

  it('does not let a superseded waterfall completion clear the active request gate', async () => {
    const staleWaterfall = deferred<ReturnType<typeof result>>();
    const currentWaterfall = deferred<ReturnType<typeof result>>();
    const category = vi.fn()
      .mockResolvedValueOnce(result('source-a', 'first', 1))
      .mockReturnValueOnce(staleWaterfall.promise)
      .mockResolvedValueOnce(result('source-a', 'filtered', 1))
      .mockReturnValueOnce(currentWaterfall.promise);
    const { workflow } = createHarness({ home: vi.fn(), category });
    workflow.updateOptions({ aggregateMode: false, waterfall: true });

    workflow.chooseCategory('genre');
    await vi.waitFor(() => expect(workflow.getSnapshot().loading).toBe(false));
    workflow.loadMoreForWaterfall();
    workflow.chooseFilter('area', 'west');
    await vi.waitFor(() => expect(workflow.getSnapshot().loading).toBe(false));

    workflow.loadMoreForWaterfall();
    expect(category).toHaveBeenCalledTimes(4);
    // A route transition may clear the spinner before an already-started IPC request settles.
    workflow.clearLoading();
    staleWaterfall.resolve(result('source-a', 'stale-page', 2));
    await staleWaterfall.promise;
    await Promise.resolve();

    workflow.loadMoreForWaterfall();
    expect(category).toHaveBeenCalledTimes(4);

    currentWaterfall.resolve(result('source-a', 'current-page', 2));
    await vi.waitFor(() => expect(workflow.getSnapshot().pg).toBe(2));
    workflow.dispose();
  });
});

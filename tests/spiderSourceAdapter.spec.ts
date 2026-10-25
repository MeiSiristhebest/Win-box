import { describe, expect, it, vi } from 'vitest';
import { SpiderSourceAdapter } from '../src/engine/vod/SpiderSourceAdapter';
import type { SpiderSourceCapabilities } from '../src/engine/vod/SpiderSourcePorts';
import { NullLogger } from '../src/engine/util/logger';
import type { SourceBean } from '../src/shared/types';
import { SourceProblemError } from '../src/engine/spider/errors';

const source = { key: 'source', type: 3, api: 'csp_Test' } as SourceBean;

function adapter(capabilities: SpiderSourceCapabilities) {
  return new SpiderSourceAdapter({ forSource: () => capabilities }, NullLogger);
}

describe('SpiderSourceAdapter capability boundary', () => {
  const unsupportedCalls: Array<[string, (value: SpiderSourceAdapter) => Promise<unknown>]> = [
    ['homeContent', (value) => value.home(source, 1000)],
    ['categoryContent', (value) => value.category(source, 'movie', '1', {})],
    ['detailContent', (value) => value.detail(source, ['movie'])],
    ['searchContent', (value) => value.search(source, 'movie', false, 1000)],
    ['playerContent', (value) => value.play(source, 'line', 'movie', [], 1000)],
  ];

  it.each(unsupportedCalls)('reports missing %s separately from a legal empty result', async (operation, invoke) => {
    await expect(invoke(adapter({}))).rejects.toMatchObject({
      code: 'OPERATION_UNSUPPORTED',
      detail: { operation, sourceKey: source.key },
    });
  });

  it('accepts a search-only source and preserves its legal empty response despite an older diagnostic', async () => {
    const value = adapter({ searchContent: () => '{"list":[]}', lastReason: 'An older failure' });

    await expect(value.search(source, 'movie', false, 1000)).resolves.toEqual([]);
    await expect(value.detail(source, ['movie'])).rejects.toMatchObject({ code: 'OPERATION_UNSUPPORTED' });
    expect(value.proxyPortFor(source)).toBeNull();
  });

  it('loads recommendations when the source does not implement a home-category operation', async () => {
    const value = adapter({ homeVideoContent: () => '{"list":[{"vod_id":"1","vod_name":"Recommended movie"}]}' });

    await expect(value.home(source, 1000)).resolves.toMatchObject({
      sourceKey: source.key,
      homeFallback: true,
      items: [{ id: '1', name: 'Recommended movie' }],
      sortClasses: [],
    });
  });

  it('keeps a category-only home response when optional recommendation and category fallbacks are absent', async () => {
    const value = adapter({ homeContent: () => '{"class":[{"type_id":"1","type_name":"Movies"}],"list":[]}' });

    await expect(value.home(source, 1000)).resolves.toMatchObject({ sortClasses: [{ id: '1', name: 'Movies' }], items: [] });
  });

  it('recovers an identified home invocation failure through recommendations', async () => {
    const value = adapter({
      homeContent: () => { throw new SourceProblemError('SPIDER_ERROR', 'home failed', { operation: 'homeContent' }); },
      homeVideoContent: () => '{"list":[{"vod_id":"1","vod_name":"Recovered movie"}]}',
    });
    await expect(value.home(source, 1000)).resolves.toMatchObject({
      items: [{ id: '1', name: 'Recovered movie' }], homeFallback: true,
    });
  });

  it('preserves the original invocation failure when optional recovery fails too', async () => {
    const failure = new SourceProblemError('SPIDER_ERROR', 'original home failure', { operation: 'homeContent' });
    const value = adapter({
      homeContent: () => { throw failure; },
      homeVideoContent: () => { throw new Error('recommendation failure'); },
    });
    await expect(value.home(source, 1000)).rejects.toBe(failure);
  });

  it('does not retry other methods when runtime preparation itself failed', async () => {
    const failure = new SourceProblemError('SPIDER_ERROR', 'runtime preparation failed', { sourceKey: source.key });
    const homeVideoContent = vi.fn(() => '{"list":[]}');
    const value = adapter({ homeContent: () => { throw failure; }, homeVideoContent });
    await expect(value.home(source, 1000)).rejects.toBe(failure);
    expect(homeVideoContent).not.toHaveBeenCalled();
  });

  it('distinguishes a valid empty home from an unsupported home', async () => {
    await expect(adapter({ homeContent: () => '{"class":[],"list":[]}' }).home(source, 1000)).rejects.toMatchObject({ code: 'EMPTY_RESULT' });
  });

  it('does not resolve or start a runtime after search cancellation', async () => {
    const forSource = vi.fn(() => ({ searchContent: () => '{"list":[]}' }));
    const value = new SpiderSourceAdapter({ forSource }, NullLogger);
    const cancelled = new Error('Cancelled by caller');
    const signal = AbortSignal.abort(cancelled);

    await expect(value.search(source, 'movie', false, 1000, signal)).rejects.toMatchObject({
      name: 'AbortError',
      message: cancelled.message,
      cause: cancelled,
    });
    expect(forSource).not.toHaveBeenCalled();
  });

  it('normalizes cancellation while a runtime search is pending', async () => {
    const controller = new AbortController();
    const reason = new Error('query superseded');
    let finishSearch!: (value: string) => void;
    const value = adapter({
      searchContent: () => new Promise(resolve => { finishSearch = resolve; }),
    });

    const pending = value.search(source, 'movie', false, 1000, controller.signal);
    controller.abort(reason);

    await expect(pending).rejects.toMatchObject({ name: 'AbortError', message: reason.message, cause: reason });
    finishSearch('{"list":[]}');
  });

  it('forwards the caller cancellation signal to the runtime search capability', async () => {
    const controller = new AbortController();
    const searchContent = vi.fn((_term: string, _quick: boolean, _timeoutMs: number, signal?: AbortSignal) => {
      expect(signal).toBe(controller.signal);
      return '{"list":[]}';
    });
    const value = adapter({ searchContent });

    await expect(value.search(source, 'movie', false, 1000, controller.signal)).resolves.toEqual([]);
    expect(searchContent).toHaveBeenCalledTimes(1);
  });
});

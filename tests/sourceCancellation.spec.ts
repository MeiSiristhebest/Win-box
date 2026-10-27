import { describe, expect, it, vi } from 'vitest';
import { CmsSourceAdapter } from '../src/engine/vod/CmsSourceAdapter';
import { CmsSource } from '../src/engine/vod/CmsSource';
import { SourceGateway } from '../src/engine/vod/SourceGateway';
import { SpiderSourceAdapter } from '../src/engine/vod/SpiderSourceAdapter';
import { throwIfSearchAborted } from '../src/engine/vod/searchRuntime';
import type { CmsCatalogPort, SourceCatalogPort } from '../src/engine/vod/SourcePorts';
import type { SpiderSourceProviderPort } from '../src/engine/vod/SpiderSourcePorts';
import type { SourceBean, VodItem } from '../src/shared/types';

const source = { key: 'source', type: 0, api: 'https://example.test/api' } as SourceBean;

function pendingCatalogSearch(search: SourceCatalogPort['search']): SourceCatalogPort {
  return {
    supports: () => true,
    home: async () => { throw new Error('not used'); },
    category: async () => { throw new Error('not used'); },
    detail: async () => null,
    search,
  };
}

describe('source search cancellation contract', () => {
  it('normalizes cancellation before resolving a source adapter', async () => {
    const search = vi.fn<SourceCatalogPort['search']>();
    const gateway = new SourceGateway({ catalog: [pendingCatalogSearch(search)], playback: [], proxy: [] }, { w: vi.fn() });
    const reason = new Error('query superseded');
    const signal = AbortSignal.abort(reason);

    await expect(gateway.search(source, 'movie', signal)).rejects.toMatchObject({
      name: 'AbortError', message: reason.message, cause: reason,
    });
    expect(search).not.toHaveBeenCalled();
  });

  it('normalizes cancellation while a registered adapter is still searching', async () => {
    const controller = new AbortController();
    const reason = new Error('query superseded');
    let finishSearch!: (value: VodItem[]) => void;
    const search = vi.fn<SourceCatalogPort['search']>(() => new Promise(resolve => { finishSearch = resolve; }));
    const gateway = new SourceGateway({ catalog: [pendingCatalogSearch(search)], playback: [], proxy: [] }, { w: vi.fn() });

    const pending = gateway.search(source, 'movie', false, 1000, controller.signal);
    controller.abort(reason);

    await expect(pending).rejects.toMatchObject({ name: 'AbortError', message: reason.message, cause: reason });
    finishSearch([]);
  });

  it('normalizes cancellation at the CMS adapter while preserving the signal', async () => {
    const controller = new AbortController();
    const reason = new Error('query superseded');
    let finishSearch!: (value: VodItem[]) => void;
    const catalog: CmsCatalogPort = {
      home: vi.fn(),
      category: vi.fn(),
      detail: vi.fn(),
      search: vi.fn((_api, _type, _key, _wd, _timeout, signal) => {
        expect(signal).toBe(controller.signal);
        return new Promise<VodItem[]>(resolve => { finishSearch = resolve; });
      }),
    };
    const adapter = new CmsSourceAdapter(catalog);

    const pending = adapter.search(source, 'movie', false, 1000, controller.signal);
    controller.abort(reason);

    await expect(pending).rejects.toMatchObject({ name: 'AbortError', message: reason.message, cause: reason });
    finishSearch([]);
  });

  it('passes cancellation to the Spider search capability and stops waiting promptly', async () => {
    const controller = new AbortController();
    const reason = new Error('query superseded');
    let finishSearch!: (value: string) => void;
    const searchContent = vi.fn((_keyword: string, _quick: boolean, _timeout: number, signal?: AbortSignal) => {
      expect(signal).toBe(controller.signal);
      return new Promise<string>(resolve => { finishSearch = resolve; });
    });
    const spiders: SpiderSourceProviderPort = { forSource: () => ({ searchContent }) };
    const adapter = new SpiderSourceAdapter(spiders, { i: vi.fn(), w: vi.fn() });

    const pending = adapter.search({ ...source, type: 3 }, 'movie', false, 1000, controller.signal);
    controller.abort(reason);

    await expect(pending).rejects.toMatchObject({ name: 'AbortError', message: reason.message, cause: reason });
    expect(searchContent).toHaveBeenCalledWith('movie', false, 1000, controller.signal);
    finishSearch('{"list":[]}');
  });

  it('normalizes cross-profile search cancellation', () => {
    const reason = new Error('all profiles cancelled');
    expect(() => throwIfSearchAborted(AbortSignal.abort(reason))).toThrow(
      expect.objectContaining({ name: 'AbortError', message: reason.message, cause: reason }),
    );
  });
});

describe('source browse cancellation contract', () => {
  it('aborts an in-flight CMS home HTTP request at the network boundary', async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const http = {
      request: vi.fn((request: { signal?: AbortSignal }) => {
        receivedSignal = request.signal;
        return new Promise<never>((_resolve, reject) => {
          request.signal?.addEventListener('abort', () => reject(request.signal?.reason), { once: true });
        });
      }),
    };
    const cms = new CmsSource({ http: http as never, logger: { i: vi.fn() } });
    const gateway = new SourceGateway({
      catalog: [new CmsSourceAdapter(cms)], playback: [], proxy: [],
    }, { w: vi.fn() });

    const pending = gateway.home(source, 1000, controller.signal);
    await vi.waitFor(() => expect(http.request).toHaveBeenCalledTimes(1));
    controller.abort(new Error('browse superseded'));

    await expect(pending).rejects.toMatchObject({ name: 'AbortError', message: 'browse superseded' });
    expect(receivedSignal).toBe(controller.signal);
  });

  it('aborts Spider home fallback and category runtime calls promptly', async () => {
    const homeController = new AbortController();
    const homeContent = vi.fn((_filter: boolean, signal?: AbortSignal) => new Promise<string>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const homeVideoContent = vi.fn(() => '{"list":[]}');
    const homeAdapter = new SpiderSourceAdapter({ forSource: () => ({ homeContent, homeVideoContent }) }, { i: vi.fn(), w: vi.fn() });
    const homeGateway = new SourceGateway({ catalog: [homeAdapter], playback: [], proxy: [] }, { w: vi.fn() });
    const homePending = homeGateway.home({ ...source, type: 3 }, 1000, homeController.signal);
    await vi.waitFor(() => expect(homeContent).toHaveBeenCalledTimes(1));
    homeController.abort(new Error('home superseded'));
    await expect(homePending).rejects.toMatchObject({ name: 'AbortError', message: 'home superseded' });
    expect(homeContent.mock.calls[0]?.[1]).toBe(homeController.signal);
    expect(homeVideoContent).not.toHaveBeenCalled();

    const categoryController = new AbortController();
    const categoryContent = vi.fn((_tid: string, _page: string, _filter: boolean, _extend: Record<string, string>, signal?: AbortSignal) =>
      new Promise<string>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      }));
    const categoryAdapter = new SpiderSourceAdapter({ forSource: () => ({ categoryContent }) }, { i: vi.fn(), w: vi.fn() });
    const categoryGateway = new SourceGateway({ catalog: [categoryAdapter], playback: [], proxy: [] }, { w: vi.fn() });
    const categoryPending = categoryGateway.category({ ...source, type: 3 }, 'genre', '2', {}, 1000, categoryController.signal);
    await vi.waitFor(() => expect(categoryContent).toHaveBeenCalledTimes(1));
    categoryController.abort(new Error('category superseded'));
    await expect(categoryPending).rejects.toMatchObject({ name: 'AbortError', message: 'category superseded' });
    expect(categoryContent.mock.calls[0]?.[4]).toBe(categoryController.signal);
  });
});

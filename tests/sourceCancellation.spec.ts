import { describe, expect, it, vi } from 'vitest';
import { CmsSourceAdapter } from '../src/engine/vod/CmsSourceAdapter';
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

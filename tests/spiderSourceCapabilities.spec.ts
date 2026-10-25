import { describe, expect, it, vi } from 'vitest';
import type { EngineHost } from '../src/engine/ports';
import { Spider } from '../src/engine/spider/Spider';
import { SpiderSourceRuntimeAdapter } from '../src/engine/spider/SpiderSourceRuntimeAdapter';
import { UnsupportedSpider } from '../src/engine/spider/UnsupportedSpider';
import { NullLogger } from '../src/engine/util/logger';
import type { SourceBean } from '../src/shared/types';

const source = { key: 'source', type: 3, api: 'csp_Test', runtimeScope: 'profile::source' } as SourceBean;
const host: EngineHost = {
  http: { request: async () => { throw new Error('Unexpected network request'); } },
  kv: { get: () => '', set: () => undefined, delete: () => undefined },
  logger: NullLogger,
};
const init = { key: source.runtimeScope!, api: source.api, ext: '', jar: '', host };

class EmptySpider extends Spider {}

describe('SpiderSourceRuntimeAdapter', () => {
  it('does not advertise inherited empty implementations as source capabilities', () => {
    const adapter = new SpiderSourceRuntimeAdapter({ createForSource: () => new EmptySpider(init) }, host);
    const capabilities = adapter.forSource(source);

    expect(capabilities.homeContent).toBeUndefined();
    expect(capabilities.homeVideoContent).toBeUndefined();
    expect(capabilities.categoryContent).toBeUndefined();
    expect(capabilities.detailContent).toBeUndefined();
    expect(capabilities.searchContent).toBeUndefined();
    expect(capabilities.playerContent).toBeUndefined();
    expect(capabilities.proxyPort).toBeUndefined();
  });

  it('keeps implemented methods bound to their source instance and reads current diagnostics', async () => {
    class SearchSpider extends Spider {
      reason = '';
      override searchContent(keyword: string) {
        this.reason = `searched ${keyword}`;
        return JSON.stringify({ list: [{ vod_id: this.siteKey, vod_name: keyword }] });
      }
      override get lastReason() { return this.reason; }
    }
    const spider = new SearchSpider(init);
    const createForSource = vi.fn(() => spider);
    const capabilities = new SpiderSourceRuntimeAdapter({ createForSource }, host).forSource(source);
    const search = capabilities.searchContent!;

    expect(capabilities.lastReason).toBe('');
    expect(JSON.parse(await search('movie', false)).list[0]).toEqual({ vod_id: 'profile::source', vod_name: 'movie' });
    expect(capabilities.lastReason).toBe('searched movie');
    expect(createForSource).toHaveBeenCalledWith(source, host);
  });

  it('keeps an explicitly implemented empty result distinct from an inherited unsupported stub', async () => {
    class EmptySearchSpider extends Spider {
      override searchContent(): string {
        return '';
      }
    }
    const capabilities = new SpiderSourceRuntimeAdapter(
      { createForSource: () => new EmptySearchSpider(init) },
      host,
    ).forSource(source);

    expect(capabilities.searchContent).toBeTypeOf('function');
    expect(capabilities.searchContent!('movie', false)).toBe('');
  });

  it('preserves real runtime errors instead of replacing them with an unsupported-operation error', () => {
    const spider = new UnsupportedSpider(init, 'UNSUPPORTED_JAR', 'Runtime is missing');
    const capabilities = new SpiderSourceRuntimeAdapter({ createForSource: () => spider }, host).forSource(source);

    expect(() => capabilities.searchContent!('movie', false)).toThrow(expect.objectContaining({ code: 'JAR_NO_RUNTIME', message: 'Runtime is missing' }));
  });
});

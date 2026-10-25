import { describe, expect, it, vi } from 'vitest';
import type { SourceBean } from '../src/shared/types';
import { Spider, type SpiderInit } from '../src/engine/spider/Spider';
import { SpiderLiveContentAdapter } from '../src/engine/spider/SpiderLiveContentAdapter';
import type { SpiderFactoryPort } from '../src/engine/spider/SpiderFactoryPort';
import type { SpiderRuntimeHostPort } from '../src/engine/spider/SpiderPorts';

const source = { key: 'live-source' } as SourceBean;

class BaseOnlySpider extends Spider {
  constructor() {
    const init: SpiderInit = {
      key: source.key,
      api: 'https://example.test/spider.js',
      ext: '',
      jar: '',
      host: {} as SpiderRuntimeHostPort,
    };
    super(init);
  }
}

function adapterFor(spider: Spider): SpiderLiveContentAdapter<object> {
  const factory: SpiderFactoryPort<object> = { createForSource: vi.fn(() => spider) };
  return new SpiderLiveContentAdapter(factory, {});
}

describe('SpiderLiveContentAdapter', () => {
  it('reports an inherited empty stub as unsupported instead of a successful empty feed', async () => {
    const adapter = adapterFor(new BaseOnlySpider());

    await expect(adapter.load(source, source.api ?? '')).rejects.toMatchObject({
      code: 'OPERATION_UNSUPPORTED',
      detail: { sourceKey: 'live-source', operation: 'liveContent' },
    });
  });

  it('preserves a legal empty result from a runtime that implements live content', async () => {
    class EmptyLiveSpider extends BaseOnlySpider {
      override liveContent(_url: string): string {
        return '';
      }
    }
    const adapter = adapterFor(new EmptyLiveSpider());

    await expect(adapter.load(source, 'https://example.test/live')).resolves.toBe('');
  });

  it('passes the selected live URL to the runtime implementation', async () => {
    class LiveSpider extends BaseOnlySpider {
      readonly loadContent = vi.fn((url: string) => 'feed:' + url);
      override liveContent(url: string): string {
        return this.loadContent(url);
      }
    }
    const spider = new LiveSpider();

    await expect(adapterFor(spider).load(source, 'https://example.test/live')).resolves.toBe('feed:https://example.test/live');
    expect(spider.loadContent).toHaveBeenCalledWith('https://example.test/live');
  });
});

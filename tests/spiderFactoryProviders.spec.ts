import { describe, expect, it, vi } from 'vitest';
import type { SourceBean } from '../src/shared/types';
import type { EngineHost } from '../src/engine/ports';
import { Spider, type SpiderInit } from '../src/engine/spider/Spider';
import { SpiderFactory } from '../src/engine/spider/SpiderFactory';
import type { SpiderRuntimeProvider } from '../src/engine/spider/SpiderRuntimeProvider';

class ExtensionSpider extends Spider {
  readonly protocol = 'extension';
}

describe('SpiderFactory runtime providers', () => {
  const host = { http: { request: vi.fn() }, kv: { get: vi.fn(), set: vi.fn(), delete: vi.fn() }, logger: { i: vi.fn(), w: vi.fn(), e: vi.fn() } } as unknown as EngineHost;

  it('allows an injected provider to add a protocol without editing the factory', () => {
    const supports = vi.fn((source: SourceBean) => source.api.startsWith('demo-runtime:'));
    const create = vi.fn((_source: SourceBean, init: SpiderInit<EngineHost>) => new ExtensionSpider(init));
    const provider: SpiderRuntimeProvider<EngineHost> = { supports, create };
    const factory = new SpiderFactory({ runtimeProviders: [provider] });
    const source = { key: 'demo', type: 3, api: 'demo-runtime:catalog' } as SourceBean;

    const spider = factory.createForSource(source, host);

    expect(spider).toBeInstanceOf(ExtensionSpider);
    expect(supports).toHaveBeenCalledWith(source);
    expect(create).toHaveBeenCalledWith(source, expect.objectContaining({ key: 'demo', host }));
  });

  it('keeps provider precedence explicit and cached spiders stable for identical configuration', () => {
    const first = new ExtensionSpider({ key: 'first', api: 'csp_Test', ext: '', jar: '', host });
    const second = new ExtensionSpider({ key: 'second', api: 'csp_Test', ext: '', jar: '', host });
    const providers: SpiderRuntimeProvider[] = [
      { supports: () => true, create: () => first },
      { supports: () => true, create: () => second },
    ];
    const factory = new SpiderFactory({ runtimeProviders: providers });
    const source = { key: 'same', type: 3, api: 'csp_Test' } as SourceBean;

    const spider = factory.createForSource(source, host);

    expect(spider).toBe(first);
    expect(factory.createForSource(source, host)).toBe(first);
  });

  it('preserves built-in JS, Python, and JAR selection when extensions do not match', () => {
    const factory = new SpiderFactory({ runtimeProviders: [{ supports: () => false, create: () => { throw new Error('must not create'); } }] });

    expect(factory.createForSource({ key: 'js', type: 3, api: 'https://example.test/spider.js' } as SourceBean, host).constructor.name).toBe('JsSpider');
    expect((factory.createForSource({ key: 'py', type: 3, api: 'https://example.test/spider.py' } as SourceBean, host) as unknown as { reason: string }).reason).toBe('UNSUPPORTED_PY');
    expect((factory.createForSource({ key: 'jar', type: 3, api: 'csp_Test' } as SourceBean, host) as unknown as { reason: string }).reason).toBe('UNSUPPORTED_JAR');
  });
});

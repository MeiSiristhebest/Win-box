import { describe, expect, it, vi } from 'vitest';
import type { ParseResult } from '../src/engine/config/ApiConfigParser';
import { importSubscriptionConfig, type SubscriptionConfigImportPorts } from '../src/main/subscriptions/SubscriptionConfigImport';

const validConfig = '{"sites":[{"key":"a","name":"A","type":0,"api":"https://example.test/api"}]}';

function ports(overrides: Partial<SubscriptionConfigImportPorts> = {}): SubscriptionConfigImportPorts {
  return {
    currentConfigRevision: () => 1,
    fetchConfigWithDiagnostics: vi.fn(async () => ({ text: validConfig, hint: '' })),
    importMultiRepo: vi.fn(async () => ({ warnings: ['multi imported'] }) as ParseResult),
    commitParsedConfig: vi.fn(),
    ...overrides,
  };
}

describe('importSubscriptionConfig', () => {
  it('strips #line for fetching but preserves it when delegating a multi-repository import', async () => {
    const dependencies = ports({
      fetchConfigWithDiagnostics: vi.fn(async () => ({ text: '{"urls":["https://example.test/child.json"]}', hint: '' })),
    });

    await importSubscriptionConfig({ url: 'https://example.test/root.json#line=2', name: 'My sources' }, { snapshot: true }, dependencies);

    expect(dependencies.fetchConfigWithDiagnostics).toHaveBeenCalledWith('https://example.test/root.json', undefined);
    expect(dependencies.importMultiRepo).toHaveBeenCalledWith(
      { items: [{ url: 'https://example.test/child.json' }] },
      expect.objectContaining({ preferredLine: 2, subscriptionUrl: 'https://example.test/root.json#line=2' }),
    );
    expect(dependencies.commitParsedConfig).not.toHaveBeenCalled();
  });

  it('parses pasted JSON and commits only after validation', async () => {
    const dependencies = ports();

    const result = await importSubscriptionConfig({ json: validConfig, name: 'Manual' }, { snapshot: true }, dependencies);

    expect(dependencies.fetchConfigWithDiagnostics).not.toHaveBeenCalled();
    expect(dependencies.commitParsedConfig).toHaveBeenCalledWith(result, '', true, 'Manual');
  });

  it('preserves the current config when parsed content has no usable entries', async () => {
    const dependencies = ports({
      fetchConfigWithDiagnostics: vi.fn(async () => ({ text: '{"sites":[]}', hint: '返回 HTML 拦截页' })),
    });

    await expect(importSubscriptionConfig({ url: 'https://example.test/root.json' }, { snapshot: true }, dependencies))
      .rejects.toThrow('已保留原配置不变｜诊断：返回 HTML 拦截页');
    expect(dependencies.commitParsedConfig).not.toHaveBeenCalled();
  });

  it('keeps fetch diagnostics attached to their own concurrent import', async () => {
    let resolveFirstFetch!: (value: { text: string; hint: string }) => void;
    const firstFetch = new Promise<{ text: string; hint: string }>((resolve) => { resolveFirstFetch = resolve; });
    const dependencies = ports({
      fetchConfigWithDiagnostics: vi.fn((url: string) => url.includes('first')
        ? firstFetch
        : Promise.resolve({ text: '{"sites":[]}', hint: '第二个请求诊断' })),
    });

    const firstImport = importSubscriptionConfig(
      { url: 'https://example.test/first.json' },
      { snapshot: true },
      dependencies,
    );
    const secondImport = importSubscriptionConfig(
      { url: 'https://example.test/second.json' },
      { snapshot: true },
      dependencies,
    );

    await expect(secondImport).rejects.toThrow('诊断：第二个请求诊断');
    resolveFirstFetch({ text: '{"sites":[]}', hint: '第一个请求诊断' });
    await expect(firstImport).rejects.toThrow('诊断：第一个请求诊断');
  });

  it('refuses to commit if another config update wins while the subscription is loading', async () => {
    let revision = 1;
    const dependencies = ports({
      currentConfigRevision: () => revision,
      fetchConfigWithDiagnostics: vi.fn(async () => {
        revision = 2;
        return { text: validConfig, hint: '' };
      }),
    });

    await expect(importSubscriptionConfig({ url: 'https://example.test/root.json' }, { snapshot: false }, dependencies))
      .rejects.toThrow('配置已在导入期间更改');
    expect(dependencies.commitParsedConfig).not.toHaveBeenCalled();
  });

  it('honors cancellation before parsing and before persistence', async () => {
    const controller = new AbortController();
    const dependencies = ports({
      fetchConfigWithDiagnostics: vi.fn(async () => {
        controller.abort(new Error('cancelled during fetch'));
        return { text: validConfig, hint: '' };
      }),
    });

    await expect(importSubscriptionConfig(
      { url: 'https://example.test/root.json' },
      { snapshot: true, signal: controller.signal },
      dependencies,
    )).rejects.toThrow('cancelled during fetch');
    expect(dependencies.commitParsedConfig).not.toHaveBeenCalled();
  });
});

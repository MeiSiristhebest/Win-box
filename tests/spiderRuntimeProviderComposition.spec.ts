import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spider-runtime-provider-'));
  (globalThis as unknown as { __shostDir: string }).__shostDir = dir;
  return {
    app: { getPath: () => dir, isPackaged: false },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (value: string) => Buffer.from(value, 'utf8'),
      decryptString: (value: Buffer) => Buffer.from(value).toString('utf8'),
    },
  };
});

import { rmSync } from 'node:fs';
import type { EngineHost } from '../src/engine/ports';
import { Spider, type SpiderInit } from '../src/engine/spider/Spider';
import type { SpiderRuntimeProvider } from '../src/engine/spider/SpiderRuntimeProvider';
import type { SourceBean } from '../src/shared/types';
import { createSpiderHostServicesTestFixture } from './spiderHostIntegrationFixture';

class ComposedRuntimeSpider extends Spider {
  constructor(init: SpiderInit<EngineHost>, private readonly marker: string) {
    super(init);
  }

  homeContent(): string {
    return JSON.stringify({ list: [{ vod_id: 'runtime-item', vod_name: this.marker }] });
  }
}

describe('SpiderHost runtime provider composition', () => {
  it('passes ordered runtime providers from host dependencies to the production SpiderFactory', async () => {
    const firstCreate = vi.fn((_source: SourceBean, init: SpiderInit<EngineHost>) => new ComposedRuntimeSpider(init, 'first provider'));
    const laterCreate = vi.fn((_source: SourceBean, init: SpiderInit<EngineHost>) => new ComposedRuntimeSpider(init, 'later provider'));
    const providers: readonly SpiderRuntimeProvider<EngineHost>[] = [
      { supports: (source) => source.api.startsWith('demo-runtime:'), create: firstCreate },
      { supports: (source) => source.api.startsWith('demo-runtime:'), create: laterCreate },
    ];
    const host = createSpiderHostServicesTestFixture(undefined, undefined, { runtimeProviders: providers });
    const dir = (globalThis as unknown as { __shostDir: string }).__shostDir;

    try {
      host.sourceConfiguration.addSource({
        key: 'demo-runtime',
        name: 'Demo runtime',
        type: 3,
        api: 'demo-runtime:catalog',
      } as SourceBean);

      const result = await host.sourceCatalog.home('demo-runtime');

      expect(result.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'runtime-item', name: 'first provider', sourceKey: 'demo-runtime' }),
      ]));
      expect(firstCreate).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'demo-runtime', api: 'demo-runtime:catalog' }),
        expect.objectContaining({ host: expect.any(Object) }),
      );
      expect(laterCreate).not.toHaveBeenCalled();
    } finally {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});

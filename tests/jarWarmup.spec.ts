import { describe, expect, it, vi } from 'vitest';
import { JarSpiderBridge } from '../src/engine/spider/JarSpiderBridge';
import { JarConversionRegistry } from '../src/engine/spider/JarConversionRegistry';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createWarmupBridge(conversion: Promise<string>) {
  const conversionRegistry = new JarConversionRegistry();
  const ensureConverted = vi.fn((url: string) =>
    conversionRegistry.ensure(url, () => false, () => conversion),
  );
  const logger = { w: vi.fn() };
  const bridge = Object.assign(Object.create(JarSpiderBridge.prototype), {
    conversionRegistry,
    ensureConverted,
    conversionFailure: vi.fn(() => ''),
    host: { logger },
  }) as {
    warmup(jarUrl: string): Promise<void>;
    ensureConverted: typeof ensureConverted;
  };
  return { bridge, ensureConverted, logger };
}

describe('JarSpiderBridge warmup', () => {
  it('joins the registry single-flight conversion for duplicate warmups', async () => {
    const conversion = deferred<string>();
    const { bridge, ensureConverted, logger } = createWarmupBridge(conversion.promise);
    const url = 'https://example.com/spider.jar';

    const first = bridge.warmup(url);
    const second = bridge.warmup(url);
    expect(ensureConverted).toHaveBeenCalledOnce();

    conversion.resolve('/cache/spider.jar');
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    expect(logger.w).not.toHaveBeenCalled();
  });

  it('logs one failure for concurrent warmups and keeps the other waiter settled', async () => {
    const conversion = deferred<string>();
    const { bridge, ensureConverted, logger } = createWarmupBridge(conversion.promise);

    const first = bridge.warmup('https://example.com/spider.jar');
    const second = bridge.warmup('https://example.com/spider.jar');
    expect(ensureConverted).toHaveBeenCalledOnce();

    conversion.reject(new Error('conversion failed'));
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    expect(logger.w).toHaveBeenCalledOnce();
    expect(logger.w).toHaveBeenCalledWith(expect.stringContaining('conversion failed'));
  });
});

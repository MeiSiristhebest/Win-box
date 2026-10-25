import { describe, expect, it, vi } from 'vitest';
import { ConversionInFlightError, JarConversionRegistry } from '../src/engine/spider/JarConversionRegistry';

describe('JarConversionRegistry', () => {
  it('shares concurrent conversions and reuses only validated cached artifacts', async () => {
    const registry = new JarConversionRegistry();
    let resolveConversion!: (path: string) => void;
    const convert = vi.fn(() => new Promise<string>((resolve) => { resolveConversion = resolve; }));
    const isUsable = vi.fn((path: string) => path === '/cache/converted.jar');

    const first = registry.ensure('jar-a', isUsable, convert);
    const second = registry.ensure('jar-a', isUsable, convert);
    await Promise.resolve();
    expect(convert).toHaveBeenCalledOnce();
    expect(registry.pending('jar-a')).toBe(first);

    resolveConversion('/cache/converted.jar');
    await expect(first).resolves.toBe('/cache/converted.jar');
    await expect(second).resolves.toBe('/cache/converted.jar');
    expect(registry.pending('jar-a')).toBeNull();

    await expect(registry.ensure('jar-a', isUsable, convert)).resolves.toBe('/cache/converted.jar');
    expect(convert).toHaveBeenCalledOnce();

    await expect(registry.ensure('jar-a', () => false, async () => '/cache/rebuilt.jar')).resolves.toBe('/cache/rebuilt.jar');
    expect(registry.convertedPath('jar-a')).toBe('/cache/rebuilt.jar');
  });

  it('suppresses repeated failures for the retry window and allows retry after expiry', async () => {
    let now = 10_000;
    const registry = new JarConversionRegistry(() => now);
    const convert = vi.fn(async () => { throw new Error('conversion failed'); });

    await expect(registry.ensure('jar-b', () => false, convert)).rejects.toThrow('conversion failed');
    expect(registry.failure('jar-b')).toBe('conversion failed');
    await expect(registry.ensure('jar-b', () => false, convert)).rejects.toThrow('conversion failed');
    expect(convert).toHaveBeenCalledOnce();

    now += 120_000;
    await expect(registry.ensure('jar-b', () => false, async () => '/cache/recovered.jar')).resolves.toBe('/cache/recovered.jar');
    expect(registry.failure('jar-b')).toBe('');
  });

  it('does not suppress a detached conversion that is still in flight', async () => {
    const registry = new JarConversionRegistry();
    const pendingError = new ConversionInFlightError('still running');

    await expect(registry.ensure('jar-c', () => false, async () => { throw pendingError; })).rejects.toBe(pendingError);
    expect(registry.failure('jar-c')).toBe('');
    await expect(registry.ensure('jar-c', () => false, async () => '/cache/finished.jar')).resolves.toBe('/cache/finished.jar');
  });

  it('tracks progress stages, attached work, and elapsed time', () => {
    let now = 5_000;
    const registry = new JarConversionRegistry(() => now);
    registry.startProgressIfAbsent('jar-d', { startedAt: 4_000, attached: false, stage: 'download' });
    expect(registry.progressView('jar-d')).toEqual({ startedAt: 4_000, attached: false, stage: 'download', elapsedMs: 1_000 });

    registry.setStage('jar-d', 'convert');
    now = 8_500;
    expect(registry.progressView('jar-d')).toEqual({ startedAt: 4_000, attached: false, stage: 'convert', elapsedMs: 4_500 });

    registry.attachToProgress('jar-d', 7_000);
    expect(registry.progressView('jar-d')).toEqual({ startedAt: 7_000, attached: true, stage: 'convert', elapsedMs: 1_500 });
    registry.clearProgress('jar-d');
    expect(registry.progressView('jar-d')).toBeNull();
  });
});

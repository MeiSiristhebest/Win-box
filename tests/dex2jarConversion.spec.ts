import { describe, expect, it, vi } from 'vitest';
import { Dex2jarConversion } from '../src/engine/spider/Dex2jarConversion';
import { d2jHeapMb } from '../src/engine/spider/jarBridgePolicy';
import type { DetachedDex2jarPort } from '../src/engine/spider/DetachedDex2jar';

const GiB = 1024 * 1024 * 1024;
type Run = DetachedDex2jarPort['run'];

function makeConversion(run: Run, previousLog = '') {
  const process = {
    run,
    readLog: vi.fn(() => previousLog),
    partPath: vi.fn((key: string) => `/cache/${key}.part`),
  };
  const logger = { info: vi.fn(), warn: vi.fn() };
  const removePart = vi.fn();
  const conversion = new Dex2jarConversion(process, 8 * GiB, logger, removePart);
  return { conversion, process, logger, removePart };
}

describe('Dex2jarConversion', () => {
  it('uses a memory-aware heap and delegates one successful process run', async () => {
    const run = vi.fn<Run>(async () => ({ ok: true, output: '' }));
    const { conversion } = makeConversion(run);

    await conversion.convert({ executable: 'java.exe', classpath: 'd2j.jar', rawJar: 'raw.jar', key: 'a', dexBytes: 3 * 1024 * 1024, rawJarBytes: 4 * 1024 * 1024 });

    expect(run).toHaveBeenCalledWith('java.exe', 'd2j.jar', d2jHeapMb(3 * 1024 * 1024, 8 * GiB), 'raw.jar', 'a');
    expect(run).toHaveBeenCalledOnce();
  });

  it('starts at the larger heap when the previous process log recorded an OOM', async () => {
    const run = vi.fn<Run>(async () => ({ ok: true, output: '' }));
    const { conversion, logger } = makeConversion(run, 'java.lang.OutOfMemoryError: Java heap space');

    await conversion.convert({ executable: 'java.exe', classpath: 'd2j.jar', rawJar: 'raw.jar', key: 'a', dexBytes: 3 * 1024 * 1024, rawJarBytes: 4 });

    expect(run.mock.calls[0]?.[2]).toBe(d2jHeapMb(3 * 1024 * 1024, 8 * GiB, 2));
    expect(run).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('上次转换疑似堆不足'));
  });

  it('retries one OOM with the larger heap and succeeds', async () => {
    const run = vi.fn<Run>()
      .mockResolvedValueOnce({ ok: false, output: 'OutOfMemoryError: Java heap space' })
      .mockResolvedValueOnce({ ok: true, output: '' });
    const { conversion, logger } = makeConversion(run);

    await conversion.convert({ executable: 'java.exe', classpath: 'd2j.jar', rawJar: 'raw.jar', key: 'a', dexBytes: 3 * 1024 * 1024, rawJarBytes: 4 });

    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]?.[2]).toBeGreaterThan(run.mock.calls[0]?.[2] ?? 0);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('堆不足'));
  });

  it('removes failed output and reports an exhausted OOM with actionable context', async () => {
    const run = vi.fn<Run>().mockResolvedValue({ ok: false, output: 'OutOfMemoryError: Java heap space' });
    const { conversion, process, removePart } = makeConversion(run);

    await expect(conversion.convert({ executable: 'java.exe', classpath: 'd2j.jar', rawJar: 'raw.jar', key: 'a', dexBytes: 3 * 1024 * 1024, rawJarBytes: 4 }))
      .rejects.toThrow(/classes\.dex 约 3\.0MB.*关闭其他占用内存的程序/);
    expect(run).toHaveBeenCalledTimes(2);
    expect(removePart).toHaveBeenCalledWith(process.partPath('a'));
  });

  it('keeps the useful tail and timeout marker for non-OOM failures', async () => {
    const run = vi.fn<Run>().mockResolvedValue({ ok: false, output: 'first\nsecond\nthird', timedOut: true });
    const { conversion } = makeConversion(run);

    await expect(conversion.convert({ executable: 'java.exe', classpath: 'd2j.jar', rawJar: 'raw.jar', key: 'a', dexBytes: 3, rawJarBytes: 4 }))
      .rejects.toThrow('dex2jar 转换失败（进程退出异常，转换超时）：second third');
  });
});

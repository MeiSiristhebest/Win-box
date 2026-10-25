import { describe, expect, it, vi } from 'vitest';
import type { EmbeddedPythonRuntime } from '../src/engine/spider/EmbeddedPythonRuntime';
import type { SpiderProcPool, PoolResult } from '../src/engine/spider/SpiderProcPool';
import { PythonSpiderRuntimeAdapter } from '../src/engine/spider/PythonSpiderRuntimeAdapter';
import { spiderCallSucceeded } from '../src/engine/spider/spiderCallResult';

function createAdapter(poolResult: PoolResult) {
  const runtime = {
    ensure: vi.fn().mockResolvedValue('C:/python-runtime'),
    ready: vi.fn().mockReturnValue(true),
  } as unknown as EmbeddedPythonRuntime;
  const submitToPool = vi.fn(async () => poolResult);
  const runSubprocess = vi.fn(async () => spiderCallSucceeded('one-shot'));
  const adapter = new PythonSpiderRuntimeAdapter({
    runtime,
    pool: {} as SpiderProcPool,
    logInfo: vi.fn(),
    submitToPool,
    runSubprocess,
  });
  return { adapter, submitToPool, runSubprocess };
}

describe('PythonSpiderRuntimeAdapter pooled invocation contract', () => {
  it('preserves a legal empty pool result without starting a one-shot process', async () => {
    const { adapter, runSubprocess } = createAdapter({ ok: true, data: '' });

    await expect(adapter.callPython('source.py', 'Spider', 'searchContent', ['query']))
      .resolves.toEqual(spiderCallSucceeded(''));
    expect(runSubprocess).not.toHaveBeenCalled();
  });

  it('returns a typed pool timeout without retrying the spider cold', async () => {
    const { adapter, runSubprocess } = createAdapter({ ok: false, data: '', reason: 'timeout' });

    await expect(adapter.callPython('source.py', 'Spider', 'searchContent', ['query'], 4000))
      .resolves.toMatchObject({ ok: false, problemCode: 'SPIDER_TIMEOUT' });
    expect(runSubprocess).not.toHaveBeenCalled();
  });

  it('returns a spider execution error without replaying it in a one-shot process', async () => {
    const { adapter, runSubprocess } = createAdapter({ ok: true, data: '', error: 'RuntimeError: spider failed' });

    await expect(adapter.callPython('source.py', 'Spider', 'searchContent', ['query']))
      .resolves.toMatchObject({ ok: false });
    expect(runSubprocess).not.toHaveBeenCalled();
  });

  it('propagates cancellation instead of falling through to a one-shot process', async () => {
    const { adapter, runSubprocess } = createAdapter({ ok: false, data: '', reason: 'cancelled' });

    await expect(adapter.callPython('source.py', 'Spider', 'searchContent', ['query']))
      .rejects.toMatchObject({ name: 'AbortError', message: '搜索已取消' });
    expect(runSubprocess).not.toHaveBeenCalled();
  });

  it('uses a one-shot process after a pool transport failure', async () => {
    const { adapter, runSubprocess } = createAdapter({ ok: false, data: '', reason: 'spawn-error' });

    await expect(adapter.callPython('source.py', 'Spider', 'searchContent', ['query']))
      .resolves.toEqual(spiderCallSucceeded('one-shot'));
    expect(runSubprocess).toHaveBeenCalledOnce();
  });
});

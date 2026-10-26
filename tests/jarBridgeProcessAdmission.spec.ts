import { describe, expect, it, vi } from 'vitest';
import type { SpiderProcPool } from '../src/engine/spider/SpiderProcPool';
import { OneShotProcessBudget, effectiveGlobalCap } from '../src/engine/spider/SpiderProcPool';
import type { SpiderCallResult } from '../src/engine/spider/spiderCallResult';
import { JarSpiderBridge } from '../src/engine/spider/JarSpiderBridge';

type AdmissionHarness = {
  processAdmission: Pick<SpiderProcPool, 'tryAcquireFallbackProcessSlot'>;
  subprocessRunner: { run: ReturnType<typeof vi.fn> };
  runSubprocessWithinProcessBudget: (
    exe: string,
    argv: string[],
    className: string,
    method: string,
  ) => Promise<SpiderCallResult>;
};

function bridgeHarness(
  processAdmission: Pick<SpiderProcPool, 'tryAcquireFallbackProcessSlot'>,
  run: () => Promise<SpiderCallResult>,
) {
  const bridge = Object.create(JarSpiderBridge.prototype) as AdmissionHarness;
  bridge.processAdmission = processAdmission;
  bridge.subprocessRunner = { run: vi.fn(run) };
  return bridge;
}

describe('JarSpiderBridge cold-process admission', () => {
  it('does not start a one-shot child when the shared process budget is exhausted', async () => {
    const run = vi.fn(async () => ({ ok: true, output: 'unused', reason: '', failureKind: null, problemCode: null } as SpiderCallResult));
    const processAdmission = new OneShotProcessBudget();
    const activeSlots = Array.from({ length: effectiveGlobalCap() }, () => processAdmission.tryAcquireFallbackProcessSlot());
    expect(activeSlots.every((slot) => slot !== null)).toBe(true);
    const bridge = bridgeHarness(processAdmission, run);

    await expect(bridge.runSubprocessWithinProcessBudget('java', [], 'Spider', 'searchContent'))
      .resolves.toMatchObject({ ok: false, problemCode: 'SPIDER_CAPACITY' });
    expect(run).not.toHaveBeenCalled();

    activeSlots[0]?.();
    await expect(bridge.runSubprocessWithinProcessBudget('java', [], 'Spider', 'searchContent'))
      .resolves.toMatchObject({ ok: true, output: 'unused' });
    expect(run).toHaveBeenCalledOnce();
    const releasedAfterRun = processAdmission.tryAcquireFallbackProcessSlot();
    expect(releasedAfterRun).toBeTypeOf('function');
    releasedAfterRun?.();
    for (const release of activeSlots.slice(1)) release?.();
  });

  it('releases the shared process slot after the one-shot process settles', async () => {
    const processAdmission = new OneShotProcessBudget();
    const run = vi.fn(async () => ({ ok: true, output: 'ok', reason: '', failureKind: null, problemCode: null } as SpiderCallResult));
    const bridge = bridgeHarness(processAdmission, run);

    await expect(bridge.runSubprocessWithinProcessBudget('python', [], 'Spider', 'searchContent'))
      .resolves.toMatchObject({ ok: true, output: 'ok' });
    expect(run).toHaveBeenCalledOnce();
    const slotAfterSettledRun = processAdmission.tryAcquireFallbackProcessSlot();
    expect(slotAfterSettledRun).toBeTypeOf('function');
    slotAfterSettledRun?.();
  });
});

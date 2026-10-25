import { describe, expect, it } from 'vitest';
import { spiderPoolTimeoutResult } from '../src/engine/spider/spiderPoolFailure';

describe('spider process-pool timeout policy', () => {
  it('returns a typed timeout without requesting a cold-process retry', () => {
    expect(spiderPoolTimeoutResult('timeout', 20_000)).toEqual({
      ok: false,
      output: '',
      reason: '蜘蛛调用超时（>20s），源站可能无响应',
      failureKind: null,
      problemCode: 'SPIDER_TIMEOUT',
    });
  });

  it('returns the same queue-timeout outcome for every pooled runtime', () => {
    expect(spiderPoolTimeoutResult('queue-timeout', 20_000)).toEqual({
      ok: false,
      output: '',
      reason: '并发排队超时（同时查询的源太多），稍后重试该源即可',
      failureKind: null,
      problemCode: 'SPIDER_TIMEOUT',
    });
  });

  it('leaves transport failures and cancellation to the runtime adapter policy', () => {
    expect(spiderPoolTimeoutResult('exit', 20_000)).toBeNull();
    expect(spiderPoolTimeoutResult('cancelled', 20_000)).toBeNull();
    expect(spiderPoolTimeoutResult(undefined, 20_000)).toBeNull();
  });
});

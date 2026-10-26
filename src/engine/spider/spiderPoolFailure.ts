import { spiderCallFailed, type SpiderCallResult } from './spiderCallResult';

/** Pool timeouts are completed calls, not transport failures worth retrying cold. */
export function spiderPoolTimeoutResult(reason: string | undefined, timeoutMs: number): SpiderCallResult | null {
  if (reason === 'timeout') {
    return spiderCallFailed('', `蜘蛛调用超时（>${Math.round(timeoutMs / 1000)}s），源站可能无响应`, null, 'SPIDER_TIMEOUT');
  }

  if (reason === 'queue-timeout') {
    return spiderCallFailed('', '并发排队超时（同时查询的源太多），稍后重试该源即可', null, 'SPIDER_TIMEOUT');
  }

  return null;
}

/** Capacity is backpressure, not a transport failure eligible for cold retry. */
export function spiderPoolCapacityResult(reason: string | undefined): SpiderCallResult | null {
  if (reason !== 'capacity-exhausted') return null;
  return spiderCallFailed('', '蜘蛛运行数量已达上限，请稍后重试', null, 'SPIDER_CAPACITY');
}

/** Oversized/malformed pool output is a protocol failure and is never replayed cold. */
export function spiderPoolOutputLimitResult(reason: string | undefined): SpiderCallResult | null {
  if (reason !== 'output-limit') return null;
  return spiderCallFailed('', '蜘蛛运行输出超过安全上限，已终止该调用', null, 'SPIDER_OUTPUT_LIMIT');
}

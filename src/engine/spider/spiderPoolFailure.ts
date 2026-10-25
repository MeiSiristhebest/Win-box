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

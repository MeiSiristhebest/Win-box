import { classifySpiderFailure, translateSpiderLog, type SpiderFailureKind } from './spiderDiagnostics';
import type { SourceProblemCode } from './errors';

const UNSUPPORTED_OPERATION_PREFIX = 'WINBOX_OPERATION_UNSUPPORTED:';

const OPERATION_LABELS: Record<string, string> = {
  homeContent: '首页',
  homeVideoContent: '推荐内容',
  categoryContent: '分类浏览',
  detailContent: '影片详情',
  searchContent: '搜索',
  playerContent: '播放',
  liveContent: '直播',
  proxy: '本地代理',
};

/** Converts a machine-readable missing-operation marker to stable user-facing wording. */
export function unsupportedSpiderOperationReason(raw: string): string | null {
  if (!raw.includes(UNSUPPORTED_OPERATION_PREFIX)) return null;
  const operation = raw.match(/WINBOX_OPERATION_UNSUPPORTED:([A-Za-z][A-Za-z0-9_]*)/)?.[1];
  if (!operation) return null;
  const label = OPERATION_LABELS[operation] ?? `「${operation}」`;
  return `该源未提供${label}功能`;
}

export interface SpiderRuntimeFailure {
  reason: string;
  problemCode: SourceProblemCode;
  failureKind: SpiderFailureKind | null;
}

/** Normalizes subprocess and worker-envelope failures to the application contract. */
export function normalizeSpiderRuntimeFailure(raw: string): SpiderRuntimeFailure {
  const unsupportedReason = unsupportedSpiderOperationReason(raw);
  return {
    reason: unsupportedReason ?? translateSpiderLog(raw),
    problemCode: unsupportedReason ? 'OPERATION_UNSUPPORTED' : 'SPIDER_ERROR',
    failureKind: classifySpiderFailure(raw),
  };
}

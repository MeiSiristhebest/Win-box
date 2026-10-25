import { DEFAULT_SPIDER_TIMEOUT_MS } from '../spider/Spider';

/** Timeout policy shared by spider calls and aggregate search scheduling. */
export function sourceTimeoutMs(bean: { timeout?: number } | null | undefined): number {
  const seconds = Number(bean?.timeout) || 0;
  if (!(seconds > 0)) return DEFAULT_SPIDER_TIMEOUT_MS;
  return Math.min(60_000, Math.max(5_000, Math.round(seconds * 1000)));
}

/** Caller budgets can shorten a source timeout, never extend its declared limit. */
export function sourceSearchBudgetMs(bean: { timeout?: number }, requestedMs?: number): number {
  const configuredMs = sourceTimeoutMs(bean);
  if (!Number.isFinite(requestedMs) || (requestedMs ?? 0) <= 0) return configuredMs;
  return Math.min(configuredMs, Math.max(1, Math.floor(requestedMs!)));
}


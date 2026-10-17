import type { SubscriptionImportPolicy } from './ImportPolicy';

export interface SubscriptionImportBatchProgress {
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  pending: number;
  currentName?: string;
}

export interface SubscriptionImportBatchItem<TItem, TResult> {
  item: TItem;
  label: string;
  result: TResult;
}

export interface SubscriptionImportBatchResult<TItem, TResult> {
  candidateIndices: number[];
  completed: Array<SubscriptionImportBatchItem<TItem, TResult> | null>;
  skippedByIndex: Array<string | null>;
  pendingByIndex: boolean[];
  succeeded: number;
  failed: number;
  truncated: number;
  cancelled: boolean;
  budgetExceeded: boolean;
}

export async function executeSubscriptionImportBatch<TItem, TResult>(options: {
  items: readonly TItem[];
  selectedIndices: readonly number[];
  signal?: AbortSignal;
  policy: Pick<SubscriptionImportPolicy, 'maxConcurrentChildren' | 'maxItemsPerRun' | 'itemTimeoutMs' | 'totalDurationMs'>;
  labelFor: (item: TItem, index: number) => string;
  unavailableReason?: (item: TItem, index: number) => string | null;
  load: (item: TItem, signal: AbortSignal) => Promise<TResult>;
  initialCounts?: (selected: ReadonlySet<number>) => { succeeded: number; failed: number };
  onProgress?: (progress: SubscriptionImportBatchProgress) => void;
}): Promise<SubscriptionImportBatchResult<TItem, TResult>> {
  const candidateIndices = options.selectedIndices.slice(0, options.policy.maxItemsPerRun);
  const selected = new Set(candidateIndices);
  const counts = options.initialCounts?.(selected) ?? { succeeded: 0, failed: 0 };
  let succeeded = counts.succeeded;
  let failed = counts.failed;
  const completed: Array<SubscriptionImportBatchItem<TItem, TResult> | null> = Array.from({ length: options.items.length }, () => null);
  const skippedByIndex: Array<string | null> = Array.from({ length: options.items.length }, () => null);
  const pendingByIndex = Array.from({ length: options.items.length }, () => false);
  const reportProgress = (currentName?: string): void => options.onProgress?.({
    total: options.items.length,
    completed: succeeded + failed,
    succeeded,
    failed,
    pending: Math.max(0, options.items.length - succeeded - failed),
    ...(currentName ? { currentName } : {}),
  });

  const started = Date.now();
  const deadlineAt = started + options.policy.totalDurationMs;
  const budgetController = new AbortController();
  const isBudgetExceeded = (): boolean => {
    if (!budgetController.signal.aborted && Date.now() >= deadlineAt) {
      budgetController.abort(new Error('多仓导入达到时间限制'));
    }
    return budgetController.signal.aborted;
  };
  const batchSignal = options.signal
    ? AbortSignal.any([options.signal, budgetController.signal])
    : budgetController.signal;
  const budgetTimer = setTimeout(
    () => budgetController.abort(new Error('多仓导入达到时间限制')),
    options.policy.totalDurationMs,
  );
  let nextCandidate = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const candidateIndex = nextCandidate++;
      if (candidateIndex >= candidateIndices.length) return;
      const index = candidateIndices[candidateIndex];
      const item = options.items[index];
      const label = options.labelFor(item, index);
      if (options.signal?.aborted) {
        skippedByIndex[index] = '用户取消时尚未开始';
        pendingByIndex[index] = true;
        reportProgress(label);
        continue;
      }
      if (batchSignal.aborted || isBudgetExceeded()) {
        skippedByIndex[index] = `「${label}」未尝试（批量导入达到 ${Math.round(options.policy.totalDurationMs / 1000)} 秒时间限制）`;
        pendingByIndex[index] = true;
        reportProgress(label);
        continue;
      }
      const unavailable = options.unavailableReason?.(item, index);
      if (unavailable) {
        skippedByIndex[index] = `「${label}」${unavailable}`;
        failed++;
        reportProgress(label);
        continue;
      }

      const itemController = new AbortController();
      const itemSignal = AbortSignal.any([batchSignal, itemController.signal]);
      const itemTimer = setTimeout(
        () => itemController.abort(new Error('单个子仓导入达到时间限制')),
        options.policy.itemTimeoutMs,
      );
      try {
        const result = await options.load(item, itemSignal);
        if (options.signal?.aborted) {
          skippedByIndex[index] = '用户取消时未完成';
          pendingByIndex[index] = true;
          reportProgress(label);
          continue;
        }
        if (isBudgetExceeded()) {
          skippedByIndex[index] = `「${label}」未完成（批量导入达到 ${Math.round(options.policy.totalDurationMs / 1000)} 秒时间限制）`;
          pendingByIndex[index] = true;
          reportProgress(label);
          continue;
        }
        if (itemController.signal.aborted) throw itemController.signal.reason ?? new Error('单个子仓导入达到时间限制');
        completed[index] = { item, label, result };
        succeeded++;
      } catch (error) {
        if (options.signal?.aborted) {
          skippedByIndex[index] = '用户取消时未完成';
          pendingByIndex[index] = true;
        } else if (isBudgetExceeded()) {
          skippedByIndex[index] = `「${label}」未完成（批量导入达到 ${Math.round(options.policy.totalDurationMs / 1000)} 秒时间限制）`;
          pendingByIndex[index] = true;
        } else {
          const message = error instanceof Error ? error.message : String(error);
          skippedByIndex[index] = `「${label}」${message}`;
          failed++;
        }
      } finally {
        clearTimeout(itemTimer);
      }
      reportProgress(label);
    }
  };

  try {
    reportProgress();
    const workerCount = Math.min(options.policy.maxConcurrentChildren, candidateIndices.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  } finally {
    clearTimeout(budgetTimer);
  }

  return {
    candidateIndices,
    completed,
    skippedByIndex,
    pendingByIndex,
    succeeded,
    failed,
    truncated: options.selectedIndices.length - candidateIndices.length,
    cancelled: options.signal?.aborted === true,
    budgetExceeded: isBudgetExceeded(),
  };
}

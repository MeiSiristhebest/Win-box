export interface HistoryUpdateCandidate<T> {
  key: string;
  watchedEpisode: number;
  subject: T;
}

export interface HistoryUpdateLookupPort<T> {
  latestEpisode(candidate: HistoryUpdateCandidate<T>): Promise<number | null>;
}

export interface HistoryUpdateDetection {
  checkedKeys: string[];
  updatedKeys: string[];
  hasMore: boolean;
}

/** Checks a bounded batch with a fixed worker pool; network failures never become false update badges. */
export async function detectHistoryUpdates<T>(
  candidates: HistoryUpdateCandidate<T>[],
  alreadyChecked: ReadonlySet<string>,
  port: HistoryUpdateLookupPort<T>,
  batchLimit = 12,
  concurrency = 3,
): Promise<HistoryUpdateDetection> {
  const seen = new Set(alreadyChecked);
  const pending = candidates.filter((candidate) => {
    if (seen.has(candidate.key)) return false;
    seen.add(candidate.key);
    return true;
  });
  const safeBatchLimit = Number.isFinite(batchLimit) ? Math.max(0, Math.floor(batchLimit)) : 0;
  const batch = pending.slice(0, safeBatchLimit);
  const checkedKeys = batch.map((candidate) => candidate.key);
  const updatedKeys: string[] = [];
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= batch.length) return;
      const candidate = batch[index];
      if (candidate.watchedEpisode <= 0) continue;
      try {
        const latestEpisode = await port.latestEpisode(candidate);
        if (latestEpisode !== null && latestEpisode > candidate.watchedEpisode) {
          updatedKeys.push(candidate.key);
        }
      } catch {
        // A failed source lookup is unknown, not evidence of a new episode.
      }
    }
  };

  const safeConcurrency = Number.isFinite(concurrency) ? Math.max(1, Math.floor(concurrency)) : 1;
  const workerCount = Math.min(batch.length, safeConcurrency);
  await Promise.all(Array.from({ length: workerCount }, worker));

  return { checkedKeys, updatedKeys, hasMore: pending.length > batch.length };
}

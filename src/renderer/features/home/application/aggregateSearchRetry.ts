import type { AggregateSearchSessionClock } from './aggregateSearchSession';

export interface AggregateSearchRetryPolicy {
  delayMs: number;
  maxAttempts: number;
}

const DEFAULT_POLICY: AggregateSearchRetryPolicy = {
  delayMs: 30_000,
  maxAttempts: 12,
};

/** Schedules bounded retries for sources that were still pending after a search. */
export class AggregateSearchRetrySchedule {
  private attempts = 0;
  private timer: unknown = null;

  constructor(
    private readonly clock: AggregateSearchSessionClock,
    private readonly policy: AggregateSearchRetryPolicy = DEFAULT_POLICY,
  ) {}

  schedule(isCurrent: () => boolean, retry: () => void): boolean {
    if (this.attempts >= this.policy.maxAttempts) return false;
    this.cancelPending();
    this.attempts += 1;
    this.timer = this.clock.schedule(() => {
      this.timer = null;
      if (isCurrent()) retry();
    }, this.policy.delayMs);
    return true;
  }

  reset(): void {
    this.cancelPending();
    this.attempts = 0;
  }

  cancel(): void {
    this.cancelPending();
  }

  private cancelPending(): void {
    if (this.timer === null) return;
    this.clock.cancel(this.timer);
    this.timer = null;
  }
}

/** Runtime limits for remote subscription imports. */
export interface SubscriptionImportPolicy {
  readonly maxConcurrentChildren: number;
  readonly maxItemsPerRun: number;
  readonly itemTimeoutMs: number;
  readonly totalDurationMs: number;
  readonly requestTimeoutMs: Readonly<{ standard: number; quick: number }>;
  readonly maxQuickAttempts: number;
}

export const SUBSCRIPTION_IMPORT_POLICY: Readonly<SubscriptionImportPolicy> = Object.freeze({
  maxConcurrentChildren: 8,
  maxItemsPerRun: 128,
  itemTimeoutMs: 30_000,
  totalDurationMs: 120_000,
  requestTimeoutMs: Object.freeze({
    standard: 30_000,
    quick: 12_000,
  }),
  maxQuickAttempts: 4,
});

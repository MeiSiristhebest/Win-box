import type { ParseResult } from '../../engine/config/ApiConfigParser';
import type { ImportReport, SubscriptionImportProgressEvent } from '../../shared/types';
import type { SubscriptionConfigImportSource } from './SubscriptionConfigImport';
import type { SubscriptionImportRunner } from './SubscriptionImportJobContracts';

/** Operations needed by the import use case to own background job lifecycle. */
export interface SubscriptionImportJobsPort {
  start(url: string, name: string, runner: SubscriptionImportRunner): SubscriptionImportProgressEvent;
  cancel(jobId: string): SubscriptionImportProgressEvent;
  retryFailed(jobId: string): SubscriptionImportProgressEvent;
  continuePending(jobId: string): SubscriptionImportProgressEvent;
  get(jobId: string): SubscriptionImportProgressEvent | null;
  list(): SubscriptionImportProgressEvent[];
  resumeInterrupted(jobId: string): SubscriptionImportProgressEvent;
  dispose(): void;
}

/** Configuration operations consumed by the application facade. */
export interface SubscriptionConfigurationImportPort {
  createRunner(url: string, name: string): SubscriptionImportRunner;
  importConfig(
    source: SubscriptionConfigImportSource,
    options: { snapshot: boolean; signal?: AbortSignal },
  ): Promise<ParseResult>;
  readonly latestReport: ImportReport | null;
}

export interface SubscriptionRefreshPort {
  refreshIfDue(): Promise<boolean>;
}

import { splitRepoLine } from '../../engine/config/multiRepo';
import type { ImportReport, SubscriptionImportProgressEvent } from '../../shared/types';
import type { ParseResult } from '../../engine/config/ApiConfigParser';
import type {
  SubscriptionConfigurationImportPort,
  SubscriptionImportJobsPort,
  SubscriptionRefreshPort,
} from './SubscriptionImportApplicationPorts';

/** Application boundary joining import-job lifecycle with subscription configuration use cases. */
export class SubscriptionImportApplicationService {
  constructor(
    private readonly jobs: SubscriptionImportJobsPort,
    private readonly configuration: SubscriptionConfigurationImportPort,
    private readonly autoRefresh: SubscriptionRefreshPort,
  ) {}

  start(url: string, name = ''): SubscriptionImportProgressEvent {
    const sourceUrl = String(url || '').trim();
    if (!/^https?:\/\//i.test(splitRepoLine(sourceUrl).url)) {
      throw new Error('订阅地址必须使用 HTTP 或 HTTPS');
    }
    return this.jobs.start(sourceUrl, name, this.configuration.createRunner(sourceUrl, name));
  }

  cancel(jobId: string): SubscriptionImportProgressEvent {
    return this.jobs.cancel(jobId);
  }

  retryFailed(jobId: string): SubscriptionImportProgressEvent {
    return this.jobs.retryFailed(jobId);
  }

  continuePending(jobId: string): SubscriptionImportProgressEvent {
    return this.jobs.continuePending(jobId);
  }

  get(jobId: string): SubscriptionImportProgressEvent | null {
    return this.jobs.get(jobId);
  }

  list(): SubscriptionImportProgressEvent[] {
    return this.jobs.list();
  }

  resumeInterrupted(jobId: string): SubscriptionImportProgressEvent {
    return this.jobs.resumeInterrupted(jobId);
  }

  importConfig(
    source: { url?: string; json?: string; name?: string },
    options: { snapshot?: boolean; signal?: AbortSignal } = {},
  ): Promise<ParseResult> {
    return this.configuration.importConfig(source, {
      snapshot: options.snapshot !== false,
      signal: options.signal,
    });
  }

  get latestReport(): ImportReport | null {
    return this.configuration.latestReport;
  }

  refreshIfDue(): Promise<boolean> {
    return this.autoRefresh.refreshIfDue();
  }

  dispose(): void {
    this.jobs.dispose();
  }
}

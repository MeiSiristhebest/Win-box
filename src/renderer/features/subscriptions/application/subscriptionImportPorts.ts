import type { ImportReport, SubscriptionImportProgressEvent } from '../../../../shared/types';

export interface ImportedSourceSummary {
  report: ImportReport;
  warnings: string[];
}

export interface LocalJsonImportResult {
  ok: boolean;
  file?: string;
  name?: string;
  error?: string;
  result?: ImportedSourceSummary;
}

export interface LocalPythonImportResult {
  ok: boolean;
  key?: string;
  error?: string;
}

export interface LocalPackageImportResult {
  ok: boolean;
  root?: string;
  rel?: string;
  sites?: number;
  name?: string;
  needsName?: boolean;
  error?: string;
  warnings?: string[];
  result?: ImportedSourceSummary;
}

export interface LocalLiveImportResult {
  ok: boolean;
  needsName?: boolean;
  path?: string;
  name?: string;
  index?: number;
  replaced?: boolean;
  total?: number;
  error?: string;
}

/** Background multi-repository import jobs. */
export interface SubscriptionImportJobsPort {
  onProgress(listener: (event: SubscriptionImportProgressEvent) => void): () => void;
  listJobs(): Promise<SubscriptionImportProgressEvent[]>;
  startJob(url: string, name?: string): Promise<SubscriptionImportProgressEvent>;
  cancelJob(jobId: string): Promise<SubscriptionImportProgressEvent>;
  retryFailed(jobId: string): Promise<SubscriptionImportProgressEvent>;
  continuePending(jobId: string): Promise<SubscriptionImportProgressEvent>;
  resumeInterrupted(jobId: string): Promise<SubscriptionImportProgressEvent>;
}

/** User-selected local source files and package folders. */
export interface LocalSourceImportPort {
  importJsonFile(name?: string): Promise<LocalJsonImportResult>;
  importPythonFiles(): Promise<LocalPythonImportResult>;
  importPackage(name?: string, root?: string): Promise<LocalPackageImportResult>;
  importLiveFile(args?: { name?: string; path?: string }): Promise<LocalLiveImportResult>;
}

/** Best-effort memory for reconnecting this renderer to its active import job. */
export interface SubscriptionImportJobMemoryPort {
  readJobId(): string;
  rememberJobId(jobId: string): void;
  forgetJobId(): void;
}

import type { ConfigRuntimeSyncRetryResult, ConfigRuntimeSyncStatus } from '../../../../shared/types';

/** Narrow status/recovery capability consumed by the configuration notice. */
export interface ConfigRuntimeSyncNoticePort {
  getStatus(): Promise<ConfigRuntimeSyncStatus>;
  retry(): Promise<ConfigRuntimeSyncRetryResult>;
  subscribe(listener: (status: ConfigRuntimeSyncStatus) => void): () => void;
}

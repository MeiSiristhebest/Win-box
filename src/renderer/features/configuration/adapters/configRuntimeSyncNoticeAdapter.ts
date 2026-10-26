import { client, CONFIG_RUNTIME_SYNC_STATUS_EVENT } from '../../../api/client';
import type { ConfigRuntimeSyncStatus } from '../../../../shared/types';
import type { ConfigRuntimeSyncNoticePort } from '../application/configRuntimeSyncNoticePort';

const isTerminalImportState = (state: string): boolean =>
  state === 'completed' || state === 'partial' || state === 'failed' || state === 'cancelled' || state === 'interrupted';

/** Bridges the preload IPC client and async subscription completion events to the notice port. */
export const configRuntimeSyncNoticeAdapter: ConfigRuntimeSyncNoticePort = {
  getStatus: () => client.cfgRuntimeSyncStatus(),
  retry: () => client.cfgRetryRuntimeSync(),
  subscribe(listener) {
    const onStatus = (event: Event): void => {
      const status = (event as CustomEvent<ConfigRuntimeSyncStatus>).detail;
      if (status) listener(status);
    };
    window.addEventListener(CONFIG_RUNTIME_SYNC_STATUS_EVENT, onStatus);
    const unsubscribeImportProgress = client.onSubscriptionImportProgress((event) => {
      if (isTerminalImportState(event.state)) {
        void client.cfgRuntimeSyncStatus().catch(() => undefined);
      }
    });
    return () => {
      window.removeEventListener(CONFIG_RUNTIME_SYNC_STATUS_EVENT, onStatus);
      unsubscribeImportProgress();
    };
  },
};

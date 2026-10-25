import { join } from 'node:path';
import type { Logger, SubscriptionImportProgressEvent } from '../../shared/types';
import type { UserConfigApplicationService } from '../store/UserConfigApplicationService';
import { JsonStore } from '../store/JsonStore';
import { SubscriptionAutoRefreshService } from './SubscriptionAutoRefreshService';
import { SubscriptionImportCoordinator } from './SubscriptionImportCoordinator';
import { SubscriptionImportJobStore } from './SubscriptionImportJobStore';
import { SubscriptionImportService } from './SubscriptionImportService';
import { SubscriptionProfileImportService } from './SubscriptionProfileImportService';
import { SubscriptionImportApplicationService } from './SubscriptionImportApplicationService';

export type SubscriptionImportRuntimePorts = Omit<
  ConstructorParameters<typeof SubscriptionImportCoordinator>[0],
  'profiles' | 'recordImportedConfig' | 'logger'
>;

export interface SubscriptionAssemblyOptions {
  userDataDirectory: string;
  profiles: UserConfigApplicationService;
  logger: Logger;
  coordinator: SubscriptionImportRuntimePorts;
  onImportProgress: (event: SubscriptionImportProgressEvent) => void;
  onPersistenceError: (error: unknown) => void;
}

export interface SubscriptionAssembly {
  imports: SubscriptionImportApplicationService;
}

/** Composes subscription profile, import-job, and refresh workflows at the main-process boundary. */
export function createSubscriptionAssembly(options: SubscriptionAssemblyOptions): SubscriptionAssembly {
  const profileImport = new SubscriptionProfileImportService(options.profiles);
  const importCoordinator = new SubscriptionImportCoordinator({
    ...options.coordinator,
    profiles: options.profiles,
    recordImportedConfig: (config, url, snapshot, name) =>
      profileImport.recordImportedConfig(config, url, snapshot, name),
    logger: options.logger,
  });
  const importService = new SubscriptionImportService(
    options.onImportProgress,
    new SubscriptionImportJobStore(
      new JsonStore(join(options.userDataDirectory, 'subscription-import-jobs.json')),
    ),
    (url, name) => importCoordinator.createRunner(url, name),
    options.onPersistenceError,
  );
  const refreshStore = new JsonStore(join(options.userDataDirectory, 'auto-refresh.json'));
  const autoRefresh = new SubscriptionAutoRefreshService({
    activeSubscriptionUrl: () => options.profiles.snapshot().apiUrl,
    lastSuccessfulRefreshAt: () => Number(refreshStore.getObject<number>('lastAt', 0) || 0),
    recordSuccessfulRefreshAt: (timestamp) => {
      refreshStore.setObject('lastAt', timestamp);
      refreshStore.flush();
    },
    refresh: async (url) => {
      const result = await importCoordinator.importConfig({ url }, { snapshot: false });
      return { report: result.report };
    },
    logger: options.logger,
  });

  return {
    imports: new SubscriptionImportApplicationService(importService, importCoordinator, autoRefresh),
  };
}

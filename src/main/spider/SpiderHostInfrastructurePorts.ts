import type { DriveCodec } from '../store/DriveStore';
import type { UserConfigPersistencePort } from '../store/UserConfigApplicationService';
import type { LearnedDriveBindingStore } from './DriveBindingRequirementLearning';
import type { HttpClient as HttpClientPort, KVStore, Logger } from '../../shared/types';

export interface SpiderHostDirectories {
  userData: string;
  cache: string;
  resources: string;
  spiderCache: string;
  workerBundle: string;
}

/** Platform capabilities required to assemble the main-process source application. */
export interface SpiderHostInfrastructurePorts {
  http: HttpClientPort;
  runtimeStore: KVStore;
  userConfigPersistence: UserConfigPersistencePort;
  learnedDriveBindingStore: LearnedDriveBindingStore;
  logger: Logger;
  directories: SpiderHostDirectories;
  credentialCodec: DriveCodec;
}

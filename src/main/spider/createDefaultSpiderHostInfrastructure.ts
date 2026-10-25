import { join } from 'node:path';
import { HttpClient } from '../net/HttpClient';
import { JsonStore } from '../store/JsonStore';
import { fileLogger } from '../util/logger';
import { userDataDir, cacheDir, resourcesDir, spiderCacheDir, distDir } from '../util/paths';
import { safeStorageDriveCodec } from '../util/driveCodec';
import type { SpiderHostInfrastructurePorts } from './SpiderHostInfrastructurePorts';

/** Electron/filesystem adapter used only by the production composition root. */
export function createDefaultSpiderHostInfrastructure(): SpiderHostInfrastructurePorts {
  const userData = userDataDir();
  const cache = cacheDir();
  return {
    http: new HttpClient(),
    runtimeStore: new JsonStore(join(cache, 'spider-local.json')),
    userConfigPersistence: new JsonStore(join(userData, 'user-config.json')),
    learnedDriveBindingStore: new JsonStore(join(userData, 'drive-bind-learned.json')),
    logger: fileLogger,
    directories: {
      userData,
      cache,
      resources: resourcesDir(),
      spiderCache: spiderCacheDir(),
      workerBundle: join(distDir(), 'js-worker.cjs'),
    },
    credentialCodec: safeStorageDriveCodec(),
  };
}

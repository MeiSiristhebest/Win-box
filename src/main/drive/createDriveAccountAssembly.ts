import { join } from 'node:path';
import type { HttpClient, Logger, SourceBean } from '../../shared/types';
import { DriveAccountService } from './DriveAccountService';
import { DriveCredentialSynchronizer } from './DriveCredentialSynchronizer';
import { getAdapter } from '../net/qr';
import { runDriveWebLogin } from '../net/webLogin';
import { refreshQuarkCookieSession } from '../net/quarkTransfer';
import { ucTvAuthorize, ucTvDeviceId, ucTvExchange, ucTvPollCode } from '../net/ucTvToken';
import { DriveStore, type DriveCodec } from '../store/DriveStore';
import { UcTvStore } from '../store/UcTvStore';
import { JsonStore } from '../store/JsonStore';

export interface DriveAccountAssemblyOptions {
  userDataDirectory: string;
  spiderCacheDirectory: string;
  http: HttpClient;
  logger: Logger;
  credentialCodec: DriveCodec;
  sites: () => readonly Pick<SourceBean, 'ext'>[];
  syncCredentialFiles: () => void;
  resetSpiderRuntime: () => void;
}

export interface DriveAccountAssembly {
  drives: DriveStore;
  ucTvStore: UcTvStore;
  credentialSynchronizer: DriveCredentialSynchronizer;
  accounts: DriveAccountService;
}

/** Main-process composition boundary for persisted drive credentials and account login flows. */
export function createDriveAccountAssembly(options: DriveAccountAssemblyOptions): DriveAccountAssembly {
  const drives = new DriveStore(
    new JsonStore(join(options.userDataDirectory, 'drive-tokens.json')),
    options.logger,
    options.credentialCodec,
  );
  const ucTvStore = new UcTvStore(
    new JsonStore(join(options.userDataDirectory, 'uc-tv-token.json')),
    options.logger,
    options.credentialCodec,
  );
  const credentialSynchronizer = new DriveCredentialSynchronizer({
    userDataRoot: options.userDataDirectory,
    spiderCacheRoot: options.spiderCacheDirectory,
    sites: options.sites,
    logger: options.logger,
  });
  const accounts = new DriveAccountService({
    drives,
    ucTvStore,
    logger: options.logger,
    syncCredentialFiles: options.syncCredentialFiles,
    resetSpiderRuntime: options.resetSpiderRuntime,
    createQr: (provider) => getAdapter(provider).qrCreate(options.http, options.logger),
    pollQr: (provider, sessionId) => getAdapter(provider).qrPoll(options.http, options.logger, sessionId),
    runWebLogin: (provider) => runDriveWebLogin(provider, options.logger),
    refreshQuarkSession: (cookie) => refreshQuarkCookieSession(cookie),
    ucTv: {
      newDeviceId: ucTvDeviceId,
      authorize: ucTvAuthorize,
      poll: ucTvPollCode,
      exchange: ucTvExchange,
    },
  });

  return { drives, ucTvStore, credentialSynchronizer, accounts };
}

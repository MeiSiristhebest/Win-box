import { join } from 'node:path';
import type { Logger } from '../../shared/types';
import { wrapPlayUrlWithHeaders } from '../../shared/driveProvider';
import {
  baiduFileDelete,
  baiduDirectLinkByFsid,
  baiduResolveShare,
  baiduResolveSharedFile,
  type BaiduSharedFile,
} from '../net/baiduTransfer';
import { quarkFileDelete, quarkTransfer } from '../net/quarkTransfer';
import { ucFileDelete, ucResolveShare } from '../net/ucTransfer';
import { BaiduJvmContextReader } from './BaiduJvmContextReader';
import { DriveFileCleanupService, type DriveFileCleanupRecord } from './DriveFileCleanupService';
import { DrivePanSharePlayback } from './DrivePanSharePlayback';
import { NativeDriveSharePlayback, type NativeDriveProvider } from './NativeDriveSharePlayback';
import { parsePanProxyQuery } from '../spider/panProxyDescriptor';
import { JsonStore } from '../store/JsonStore';
import type { DrivePanSharePlaybackPorts } from './DrivePanSharePlayback';

export interface DriveSharePlaybackAssemblyOptions {
  userDataDirectory: string;
  logger: Logger;
  cookie(provider: NativeDriveProvider): string;
  isBaiduDescriptor(url: string): boolean;
  panSharePlaybackPorts?: Partial<DrivePanSharePlaybackPorts>;
}

export interface DriveSharePlaybackAssembly {
  cleanup: DriveFileCleanupService;
  panSharePlayback: DrivePanSharePlayback;
  nativeSharePlayback: NativeDriveSharePlayback;
}

/** Composes persisted cleanup and native cloud-share resolution for spider playback. */
export function createDriveSharePlaybackAssembly(
  options: DriveSharePlaybackAssemblyOptions,
): DriveSharePlaybackAssembly {
  const pendingFiles = new JsonStore(join(options.userDataDirectory, 'pending-quark-delete.json'));
  const cleanup = new DriveFileCleanupService({
    persistence: {
      read: () => pendingFiles.getObject<unknown>('list', null),
      write: (records) => {
        pendingFiles.setObject('list', records);
        pendingFiles.flush();
      },
    },
    deleteRemote: {
      quark: (cookie, parentFid, fid) => quarkFileDelete(cookie, parentFid, fid, options.logger),
      uc: (cookie, parentFid, fid) => ucFileDelete(cookie, parentFid, fid, options.logger),
      baidu: (cookie, filePath) => baiduFileDelete(cookie, filePath, options.logger),
    },
    logger: options.logger,
    now: () => Date.now(),
  });

  const baiduJvmContext = new BaiduJvmContextReader();
  const panSharePlayback = new DrivePanSharePlayback({
    cookie: options.cookie,
    cleanup,
    wrapUrl: wrapPlayUrlWithHeaders,
    logger: options.logger,
    readBaiduJvmContext: (port, fsid): Promise<BaiduSharedFile | null> => baiduJvmContext.read(port, fsid),
    resolveQuarkShare: (shareId, cookie, transferOptions) =>
      quarkTransfer(shareId, cookie, { ...transferOptions, logger: options.logger }),
    resolveUcShare: (shareId, passcode, cookie, transferOptions) =>
      ucResolveShare(shareId, passcode, cookie, { ...transferOptions, logger: options.logger }),
    resolveBaiduShare: (shareId, password, cookie, transferOptions) =>
      baiduResolveShare(shareId, password, cookie, { ...transferOptions, logger: options.logger }),
    resolveBaiduSharedFile: (file, cookie) => baiduResolveSharedFile(file, cookie, options.logger),
    resolveBaiduByFsid: (fsid, cookie) => baiduDirectLinkByFsid(fsid, cookie, options.logger),
    ...options.panSharePlaybackPorts,
  });

  const nativeSharePlayback = new NativeDriveSharePlayback({
    cookie: options.cookie,
    resolveQuarkShare: (shareId, cookie, transferOptions) =>
      quarkTransfer(shareId, cookie, { ...transferOptions, logger: options.logger }),
    resolveUcShare: (shareId, passcode, cookie, transferOptions) =>
      ucResolveShare(shareId, passcode, cookie, { ...transferOptions, logger: options.logger }),
    resolveBaiduShare: (shareId, passcode, cookie, transferOptions) =>
      baiduResolveShare(shareId, passcode, cookie, { ...transferOptions, logger: options.logger }),
    resolveKnownShareFile: (url, flag, provider, episodeId, failures) =>
      panSharePlayback.resolveKnownShareFile(url, flag, provider, episodeId, failures),
    isQuarkPanProxy: (url) => /^quark/i.test(parsePanProxyQuery(url).site || ''),
    isBaiduDescriptor: options.isBaiduDescriptor,
    enqueueCleanup: (record: Omit<DriveFileCleanupRecord, 'at'>) => cleanup.enqueue(record),
    wrapUrl: wrapPlayUrlWithHeaders,
    logger: options.logger,
  });

  return { cleanup, panSharePlayback, nativeSharePlayback };
}

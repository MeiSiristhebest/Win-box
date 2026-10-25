import { IPC } from '../../shared/ipc-channels';
import type { QrPollResult, QrSession } from '../net/qr';
import type { Logger } from '../../shared/types';
import { registerHandler } from '../util/ipcGuard';

/** Consumer-owned contract for account credentials and QR login operations. */
export interface DriveIpcPort {
  list(): Record<string, string>;
  set(provider: string, token: string): void;
  remove(provider: string): void;
  createQr(provider?: string): Promise<QrSession>;
  pollQr(provider: string, sessionId: string): Promise<QrPollResult>;
  webLogin(provider: string): Promise<void>;
  ucTvStatus(): { bound: boolean };
  createUcTvQr(): Promise<{ imageDataUrl: string }>;
  pollUcTvQr(): Promise<{ state: 'wait' | 'ok' | 'expired' | 'error'; hint?: string }>;
  removeUcTv(): void;
}

export function registerDriveIpc(accounts: DriveIpcPort, logger: Logger): void {
  registerHandler(IPC.DRIVE_GET, () => accounts.list(), logger);
  registerHandler(IPC.DRIVE_SET, (_e: unknown, args: { provider: string; token: string }) => accounts.set(args.provider, args.token), logger);
  registerHandler(IPC.DRIVE_REMOVE, (_e: unknown, provider: string) => accounts.remove(provider), logger);
  registerHandler(IPC.DRIVE_QR_CREATE, (_e: unknown, provider?: string) => accounts.createQr(provider), logger);
  registerHandler(IPC.DRIVE_QR_POLL, (_e: unknown, provider: string, sid: string) => accounts.pollQr(provider, sid), logger);
  registerHandler(IPC.DRIVE_WEB_LOGIN, (_e: unknown, provider: string) => accounts.webLogin(provider), logger);
  registerHandler(IPC.DRIVE_UC_TV_STATUS, () => accounts.ucTvStatus(), logger);
  registerHandler(IPC.DRIVE_UC_TV_QR_CREATE, () => accounts.createUcTvQr(), logger);
  registerHandler(IPC.DRIVE_UC_TV_QR_POLL, () => accounts.pollUcTvQr(), logger);
  registerHandler(IPC.DRIVE_UC_TV_REMOVE, () => accounts.removeUcTv(), logger);
}

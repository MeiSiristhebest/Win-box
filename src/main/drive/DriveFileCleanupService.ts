import type { Logger } from '../../shared/types';

export type CleanupDriveProvider = 'quark' | 'uc' | 'baidu';

export interface DriveFileCleanupRecord {
  cookie: string;
  pdirFid: string;
  fid: string;
  dirFid?: string;
  path?: string;
  at: number;
  provider?: CleanupDriveProvider;
}

export interface DriveFileCleanupOptions {
  persistence: {
    read(): unknown;
    write(records: DriveFileCleanupRecord[]): void;
  };
  deleteRemote: {
    quark(cookie: string, parentFid: string, fid: string): Promise<boolean>;
    uc(cookie: string, parentFid: string, fid: string): Promise<boolean>;
    baidu(cookie: string, path: string): Promise<boolean>;
  };
  logger: Pick<Logger, 'i'>;
  now(): number;
}

const MAX_PENDING_FILES = 200;

/** Retains temporary cloud-drive files until deletion is confirmed, including across restarts. */
export class DriveFileCleanupService {
  private pending: DriveFileCleanupRecord[] = [];
  private currentRun: Promise<void> | null = null;

  constructor(private readonly options: DriveFileCleanupOptions) {
    const stored = options.persistence.read();
    if (!Array.isArray(stored)) return;
    this.pending = stored
      .filter((item) => item && typeof item.cookie === 'string' && item.cookie &&
        (typeof item.fid === 'string' ? item.fid : '') + (item.path || '') !== '')
      .map((item) => ({
        cookie: item.cookie as string,
        pdirFid: (item.pdirFid || '') as string,
        fid: (item.fid || '') as string,
        dirFid: item.dirFid || undefined,
        path: item.path || undefined,
        at: typeof item.at === 'number' ? item.at : options.now(),
        provider: (item.provider === 'uc' || item.provider === 'baidu' ? item.provider : undefined) as CleanupDriveProvider | undefined,
      }));
  }

  enqueue(record: Omit<DriveFileCleanupRecord, 'at'> & { at?: number }): void {
    this.pending.push({ ...record, at: record.at ?? this.options.now() });
    if (this.pending.length > MAX_PENDING_FILES) this.pending.shift();
    this.persist();
  }

  deletePending(): Promise<void> {
    if (this.currentRun) return this.currentRun;
    this.currentRun = this.deleteBatch().finally(() => { this.currentRun = null; });
    return this.currentRun;
  }

  private async deleteBatch(): Promise<void> {
    if (this.pending.length === 0) return;
    // Freeze this batch so records added while remote deletion is in flight are not overwritten.
    const batch = this.pending.slice();
    const remaining: DriveFileCleanupRecord[] = [];
    for (const item of batch) {
      try {
        let deleted = false;
        if (item.provider === 'baidu') {
          deleted = await this.options.deleteRemote.baidu(item.cookie, item.path || '');
        } else {
          const remove = item.provider === 'uc'
            ? this.options.deleteRemote.uc
            : this.options.deleteRemote.quark;
          if (item.dirFid && item.provider !== 'uc') {
            deleted = await this.options.deleteRemote.quark(item.cookie, item.dirFid, item.dirFid);
          }
          if (!deleted) deleted = await remove(item.cookie, item.pdirFid, item.fid);
        }
        if (deleted) {
          this.options.logger.i(
            `网盘已删除临时文件 fid=${item.fid.slice(0, 8)}...` +
              (item.dirFid ? ` dir=${item.dirFid.slice(0, 8)}...` : '') +
              (item.path ? ` path=${item.path}` : ''),
          );
        } else {
          remaining.push(item);
        }
      } catch {
        remaining.push(item);
      }
    }
    this.pending = [...remaining, ...this.pending.filter((item) => !batch.includes(item))];
    this.persist();
  }

  private persist(): void {
    try {
      this.options.persistence.write(this.pending);
    } catch {
      // Persistence failure must not block playback; records remain in memory for the next attempt.
    }
  }
}

import type { PlayResult, Logger } from '../../shared/types';
import { driveProviderLabel } from '../../shared/driveProvider';
import { extractBaiduInnerName, extractBaiduSharedFile, extractBaiduShare, isBaiduSharePlay } from '../net/baiduTransfer';
import { extractEpisodeFid, extractEpisodeName, extractQuarkShare, isQuarkSharePlay } from '../net/quarkTransfer';
import { extractUcShare, isUcSharePlay } from '../net/ucTransfer';
import { unsupportedNestedProvider } from '../net/driveDescriptor';

export type NativeDriveProvider = 'quark' | 'uc' | 'baidu';
interface TransferResult {
  url: string;
  header: Record<string, string>;
  ok: boolean;
  reason?: string;
  fid?: string;
  pdirFid?: string;
  path?: string;
}

export interface NativeDriveShareOutcome {
  result: PlayResult | null;
  failures: Record<NativeDriveProvider, string>;
}

type TransferOptions = { innerFid?: string; innerName?: string; passcode?: string };
type CleanupRecord = {
  provider?: NativeDriveProvider;
  cookie: string;
  pdirFid: string;
  fid: string;
  dirFid?: string;
  path?: string;
};

/** Infrastructure boundary used by native share resolution. */
export interface NativeDriveSharePorts {
  cookie(provider: NativeDriveProvider): string;
  resolveQuarkShare(shareId: string, cookie: string, options: TransferOptions): Promise<TransferResult>;
  resolveUcShare(shareId: string, passcode: string, cookie: string, options: TransferOptions): Promise<TransferResult>;
  resolveBaiduShare(shareId: string, passcode: string, cookie: string, options: TransferOptions): Promise<TransferResult>;
  resolveKnownShareFile(url: string, flag: string, provider: NativeDriveProvider, episodeId: string, failures: string[]): Promise<PlayResult | null>;
  isQuarkPanProxy(url: string): boolean;
  isBaiduDescriptor(url: string): boolean;
  enqueueCleanup(record: CleanupRecord): void;
  wrapUrl(url: string, headers: Record<string, string>): string;
  logger: Pick<Logger, 'i' | 'w'>;
}

/** Resolves supported native share links before invoking a spider/JVM. */
export class NativeDriveSharePlayback {
  constructor(private readonly ports: NativeDriveSharePorts) {}

  async resolve(id: string, flag: string): Promise<NativeDriveShareOutcome> {
    const failures: Record<NativeDriveProvider, string> = { quark: '', uc: '', baidu: '' };
    const unsupported = unsupportedNestedProvider(id);
    if (unsupported) {
      return {
        result: {
          parse: 1,
          url: '',
          playUrl: '',
          flag,
          jx: 0,
          message: `该线路使用「${unsupported}」网盘（桌面端暂不支持解链）——请换夸克 / 百度 / UC 线路再播`,
        },
        failures,
      };
    }

    // FTY UC descriptors share fields with Quark; the explicit UC shape wins.
    if (extractUcShare(id, flag) && !isUcSharePlay(id)) {
      const misses: string[] = [];
      const result = await this.ports.resolveKnownShareFile(id, flag, 'uc', id, misses);
      if (result) return { result, failures };
      return {
        result: this.failureResult(flag, 'uc', misses.join('；') || '分享文件解链失败'),
        failures,
      };
    }

    if (isQuarkSharePlay(id, flag) || this.ports.isQuarkPanProxy(id)) {
      const misses: string[] = [];
      const result = await this.ports.resolveKnownShareFile(id, flag, 'quark', id, misses);
      if (result) return { result, failures };
      return {
        result: this.failureResult(flag, 'quark', misses.join('；') || '缺少分享或文件信息'),
        failures,
      };
    }

    if (isQuarkSharePlay(id, flag)) {
      const quark = await this.resolveQuark(id, flag);
      if (quark.result) return { result: quark.result, failures };
      failures.quark = quark.failure;
    }

    if (isUcSharePlay(id)) {
      const uc = await this.resolveUc(id, flag);
      if (uc.result) return { result: uc.result, failures };
      failures.uc = uc.failure;
    }

    if (extractBaiduSharedFile(id)) {
      const misses: string[] = [];
      const result = await this.ports.resolveKnownShareFile(id, flag, 'baidu', id, misses);
      if (result) return { result, failures };
      return {
        result: {
          parse: 1,
          url: '',
          playUrl: '',
          flag,
          jx: 0,
          ...(!this.ports.cookie('baidu') ? { needDriveCookieBind: 'baidu' as const } : {}),
          message: `百度网盘取流失败（${misses.join('；') || '分享文件解链失败'}）`,
        },
        failures,
      };
    }

    // A JSON pan descriptor carries auth state inside the spider and is resolved there.
    if (isBaiduSharePlay(id) && !this.ports.isBaiduDescriptor(id)) {
      const baidu = await this.resolveBaidu(id, flag);
      if (baidu.result) return { result: baidu.result, failures };
      failures.baidu = baidu.failure;
    }

    return { result: null, failures };
  }

  private async resolveQuark(id: string, flag: string): Promise<{ result: PlayResult | null; failure: string }> {
    const cookie = this.ports.cookie('quark');
    if (!cookie) return { result: null, failure: '未绑定夸克账号（Cookie 缺失）' };
    const share = extractQuarkShare(id, flag);
    if (!share?.sId) return { result: null, failure: '' };
    try {
      const transfer = await this.ports.resolveQuarkShare(share.sId, cookie, {
        passcode: share.passcode || '',
        innerFid: extractEpisodeFid(id),
        innerName: extractEpisodeName(id),
      });
      if (transfer.ok && transfer.url) {
        this.ports.logger.i(`quarkTransfer 直链 ok: ${transfer.url.slice(0, 90)}...`);
        if (transfer.fid) {
          this.ports.enqueueCleanup({
            cookie,
            pdirFid: transfer.pdirFid || '',
            dirFid: transfer.pdirFid || '',
            fid: transfer.fid,
          });
        }
        return { result: this.playResult(flag, transfer), failure: '' };
      }
      const reason = transfer.reason || '未知原因';
      this.ports.logger.w(`quarkTransfer 未成功(${reason})，回退蜘蛛`);
      return { result: null, failure: reason };
    } catch (error) {
      const reason = errorMessage(error);
      this.ports.logger.w(`quarkTransfer 异常回退: ${reason}`);
      return { result: null, failure: reason };
    }
  }

  private async resolveUc(id: string, flag: string): Promise<{ result: PlayResult | null; failure: string }> {
    const cookie = this.ports.cookie('uc');
    const share = extractUcShare(id, flag);
    if (!cookie) return { result: null, failure: '未绑定 UC 账号（Cookie 缺失）' };
    if (!share) return { result: null, failure: '' };
    try {
      const transfer = await this.ports.resolveUcShare(share.pwdId, share.passcode, cookie, {
        innerFid: extractEpisodeFid(id),
        innerName: extractEpisodeName(id),
      });
      if (transfer.ok && transfer.url) {
        this.ports.logger.i(`ucTransfer 直链 ok: ${transfer.url.slice(0, 90)}...`);
        if (transfer.fid) {
          this.ports.enqueueCleanup({ provider: 'uc', cookie, pdirFid: transfer.pdirFid || '', fid: transfer.fid });
        }
        return { result: this.playResult(flag, transfer), failure: '' };
      }
      const reason = transfer.reason || '未知原因';
      this.ports.logger.w(`ucTransfer 未成功(${reason})，回退蜘蛛`);
      return { result: null, failure: reason };
    } catch (error) {
      const reason = errorMessage(error);
      this.ports.logger.w(`ucTransfer 异常回退: ${reason}`);
      return { result: null, failure: reason };
    }
  }

  private async resolveBaidu(id: string, flag: string): Promise<{ result: PlayResult | null; failure: string }> {
    const cookie = this.ports.cookie('baidu');
    if (!cookie) return { result: null, failure: '未绑定百度账号（Cookie 缺失）' };
    const share = extractBaiduShare(id);
    if (!share) return { result: null, failure: '' };
    try {
      const transfer = await this.ports.resolveBaiduShare(share.short, share.pwd, cookie, {
        innerFid: extractEpisodeFid(id),
        innerName: extractBaiduInnerName(id) || extractEpisodeName(id),
      });
      if (transfer.path) {
        this.ports.enqueueCleanup({ provider: 'baidu', cookie, pdirFid: '', fid: '', path: transfer.path });
      }
      if (transfer.ok && transfer.url) {
        this.ports.logger.i(`baiduTransfer 直链 ok（${transfer.path || ''}）`);
        return { result: this.playResult(flag, transfer), failure: '' };
      }
      const reason = transfer.reason || '未知原因';
      this.ports.logger.w(`baiduTransfer 未成功(${reason})，回退蜘蛛`);
      return { result: null, failure: reason };
    } catch (error) {
      const reason = errorMessage(error);
      this.ports.logger.w(`baiduTransfer 异常回退: ${reason}`);
      return { result: null, failure: reason };
    }
  }

  private playResult(flag: string, transfer: TransferResult): PlayResult {
    return {
      parse: 0,
      url: this.ports.wrapUrl(transfer.url, transfer.header || {}),
      playUrl: '',
      flag,
      header: transfer.header || {},
      jx: 0,
    };
  }

  private failureResult(flag: string, provider: NativeDriveProvider, reason: string): PlayResult {
    const cookie = this.ports.cookie(provider);
    return {
      parse: 1,
      url: '',
      playUrl: '',
      flag,
      jx: 0,
      ...(!cookie ? { needDriveCookieBind: provider } : {}),
      message: `${driveProviderLabel(provider)}${provider === 'uc' ? ' 网盘' : '网盘'}取流失败（${reason}）`,
    };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

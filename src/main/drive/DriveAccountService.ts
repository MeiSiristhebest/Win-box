import type { Logger } from '../../shared/types';
import type { DriveStore, DriveTokens } from '../store/DriveStore';
import type { UcTvStore } from '../store/UcTvStore';
import type { QrPollResult, QrSession } from '../net/qr';
import type { WebLoginResult } from '../net/webLogin';
import type {
  UcTvExchangeResult,
  UcTvPollResult,
  UcTvQrSession,
} from '../net/ucTvToken';

export interface DriveAccountPorts {
  drives: Pick<DriveStore, 'list' | 'set' | 'remove'>;
  ucTvStore: Pick<UcTvStore, 'get' | 'set' | 'remove'>;
  logger: Pick<Logger, 'i' | 'w'>;
  syncCredentialFiles: () => void;
  resetSpiderRuntime: () => void;
  createQr: (provider: string) => Promise<QrSession>;
  pollQr: (provider: string, sessionId: string) => Promise<QrPollResult>;
  runWebLogin: (provider: string) => Promise<WebLoginResult>;
  refreshQuarkSession: (cookie: string) => Promise<{
    cookie: string;
    changed: boolean;
    status: number;
    setCookieKeys: string[];
  }>;
  ucTv: {
    newDeviceId: () => string;
    authorize: (deviceId: string) => Promise<UcTvQrSession>;
    poll: (requestId: string, queryToken: string, deviceId: string) => Promise<UcTvPollResult>;
    exchange: (requestId: string, code: string, deviceId: string) => Promise<UcTvExchangeResult>;
  };
}

export class DriveAccountService {
  private ucTvBinding: { requestId: string; queryToken: string; deviceId: string } | null = null;

  constructor(private readonly ports: DriveAccountPorts) {}

  list(): DriveTokens {
    return this.ports.drives.list();
  }

  createQr(provider = 'ali'): Promise<QrSession> {
    return this.ports.createQr(provider);
  }

  pollQr(provider: string, sessionId: string): Promise<QrPollResult> {
    return this.ports.pollQr(provider || 'ali', sessionId);
  }

  set(provider: string, token: string): void {
    this.ports.drives.set(provider, token);
    this.persistCredentialChange();
  }

  remove(provider: string): void {
    this.ports.drives.remove(provider);
    this.persistCredentialChange();
  }

  async webLogin(provider: string): Promise<void> {
    const normalizedProvider = (provider || 'quark').trim().toLowerCase();
    const result = await this.ports.runWebLogin(normalizedProvider);
    if (!result.done) {
      throw new Error(`${normalizedProvider}: 未检测到登录完成（请完成扫码授权，期间勿关闭登录窗口）；未保存任何变更`);
    }
    if (!result.cookie.trim()) {
      throw new Error(`${normalizedProvider}: 已检测到登录，但未抓到 Cookie，请重试`);
    }
    this.ports.drives.set(normalizedProvider, result.cookie);
    this.persistCredentialChange();
  }

  async refreshSessions(): Promise<void> {
    const quark = this.ports.drives.list().quark || '';
    if (!quark) return;

    const refreshed = await this.ports.refreshQuarkSession(quark);
    const cookieNames = refreshed.cookie
      .split(';')
      .map((part) => part.slice(0, part.indexOf('=')).trim())
      .filter(Boolean);
    this.ports.logger.i(
      `网盘会话刷新 quark status=${refreshed.status} changed=${refreshed.changed} ` +
      `cookieLen=${refreshed.cookie.length} setCookieKeys=${refreshed.setCookieKeys.join(',') || '-'} ` +
      `keys=${[...new Set(cookieNames)].join(',')}`,
    );
    if (!refreshed.changed) return;

    this.ports.drives.set('quark', refreshed.cookie);
    this.persistCredentialChange();
  }

  ucTvStatus(): { bound: boolean } {
    return { bound: !!this.ports.ucTvStore.get() };
  }

  async createUcTvQr(): Promise<{ imageDataUrl: string }> {
    const deviceId = this.ports.ucTvStore.get()?.deviceId || this.ports.ucTv.newDeviceId();
    const session = await this.ports.ucTv.authorize(deviceId);
    this.ucTvBinding = { requestId: session.reqId, queryToken: session.queryToken, deviceId };
    this.ports.logger.i(`uc-tv-token: 取码成功（reqId=${session.reqId}，device_id=${deviceId}）`);
    return { imageDataUrl: session.imageDataUrl };
  }

  async pollUcTvQr(): Promise<{ state: 'wait' | 'ok' | 'expired' | 'error'; hint?: string }> {
    const binding = this.ucTvBinding;
    if (!binding) return { state: 'expired', hint: '请先获取二维码' };

    const result = await this.ports.ucTv.poll(binding.requestId, binding.queryToken, binding.deviceId);
    if (result.state !== 'ok') {
      if (result.state === 'expired' || result.state === 'error') this.ucTvBinding = null;
      return { state: result.state, hint: result.hint };
    }

    const exchange = await this.ports.ucTv.exchange(binding.requestId, result.code || '', binding.deviceId);
    if (!exchange.ok || !exchange.token) {
      return { state: 'error', hint: exchange.hint || 'UC TV Token 兑换失败' };
    }

    this.ports.ucTvStore.set(binding.deviceId, exchange.token);
    this.ucTvBinding = null;
    this.persistCredentialChange();
    this.ports.logger.i('uc-tv-token: 绑定成功（已写入 Wex_ucpan_token / Wex_ucpan_device_id 并重置蜘蛛）');
    return { state: 'ok' };
  }

  removeUcTv(): void {
    this.ports.ucTvStore.remove();
    this.ucTvBinding = null;
    this.persistCredentialChange();
    this.ports.logger.i('uc-tv-token: 已解绑');
  }

  private persistCredentialChange(): void {
    this.ports.syncCredentialFiles();
    this.ports.resetSpiderRuntime();
  }
}

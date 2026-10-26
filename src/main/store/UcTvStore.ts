// src/main/store/UcTvStore.ts — UC TV Token（非会员 UC 原画）凭据持久化。
//
// 为什么不放 DriveStore：DriveStore 的每个键都会被 `mergeDriveTokens` 注入到**每个**蜘蛛的
// ext 里（ext.uctv=…），而 UC TV Token 只是 wex 族 SharedPreferences 的一个值（`Wex_ucpan_token`），
// 与 ext 无关 ⇒ 独立存放，避免污染所有源的 ext，也避免解绑后残留键。
//
// 落盘：<userData>/uc-tv-token.json，内容 `{ deviceId, token }`；token 经 DriveCodec 加密
//   （与 DriveStore 同口径：无 safeStorage 时退化为明文，decode 对明文原样透传）。
import type { JsonStore } from './JsonStore';
import type { DriveCodec } from './DriveStore';
import type { Logger } from '../../shared/types';

export const UCTV_STORE_KEY = 'uc-tv';

export interface UcTvRecord {
  /** 设备 ID（生成后固定；jar 侧 `UcMineProvider.d()` 缺省会自造，但我们写入种子以保持一致） */
  deviceId: string;
  /** extScreen `/token` 响应原文（即 `Wex_ucpan_token` 的值） */
  token: string;
}

export class UcTvStore {
  constructor(private store: JsonStore, private logger: Logger, private codec?: DriveCodec) {}

  /** 读取明文记录；未绑定/解密失败返回 null */
  get(): UcTvRecord | null {
    const raw = this.store.getObject<{ deviceId?: unknown; token?: unknown } | null>(UCTV_STORE_KEY, null);
    if (!raw || typeof raw.token !== 'string' || !raw.token) return null;
    const token = this.codec ? this.codec.decode(raw.token) : raw.token;
    if (token === null) {
      this.logger.w('uc-tv-token: 解密失败（请重新扫码授权）');
      return null;
    }
    if (!token.trim()) return null;
    return { deviceId: typeof raw.deviceId === 'string' ? raw.deviceId : '', token };
  }

  /** 写入/覆盖（token 加密落盘） */
  set(deviceId: string, token: string): void {
    const t = String(token || '').trim();
    if (!t) throw new Error('UC TV Token 不能为空');
    this.store.setObjectStrict(UCTV_STORE_KEY, {
      deviceId: String(deviceId || '').trim(),
      token: this.codec ? this.codec.encode(t) : t,
    });
  }

  /** 解绑（删除记录） */
  remove(): void {
    this.store.deleteStrict(UCTV_STORE_KEY);
  }
}

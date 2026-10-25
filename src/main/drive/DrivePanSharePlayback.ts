import type { Logger, PlayResult } from '../../shared/types';
import { extractEpisodeFid, extractEpisodeName, extractQuarkShare, type QuarkTransferResult } from '../net/quarkTransfer';
import { extractUcShare, type UcShareResult } from '../net/ucTransfer';
import { extractBaiduShare, extractBaiduSharedFile, extractBaiduInnerName, type BaiduSharedFile, type BaiduTransferResult } from '../net/baiduTransfer';
import type { DriveFileCleanupService } from './DriveFileCleanupService';
import type { NativeDriveProvider } from './NativeDriveSharePlayback';
import { parsePanProxyQuery } from '../spider/panProxyDescriptor';

export interface DrivePanSharePlaybackPorts {
  cookie(provider: NativeDriveProvider): string;
  cleanup: Pick<DriveFileCleanupService, 'enqueue'>;
  wrapUrl(url: string, headers: Record<string, string>): string;
  logger: Pick<Logger, 'i' | 'w'>;
  readBaiduJvmContext(port: number, fsid: string): Promise<BaiduSharedFile | null>;
  resolveQuarkShare(shareId: string, cookie: string, options: { passcode?: string; innerFid?: string; innerName?: string }): Promise<QuarkTransferResult>;
  resolveUcShare(shareId: string, passcode: string, cookie: string, options: { innerFid?: string; innerName?: string }): Promise<UcShareResult>;
  resolveBaiduShare(short: string, password: string, cookie: string, options: { innerFid?: string; innerName?: string }): Promise<BaiduTransferResult>;
  resolveBaiduSharedFile(file: BaiduSharedFile, cookie: string): Promise<BaiduTransferResult>;
  resolveBaiduByFsid(fsid: string, cookie: string): Promise<BaiduTransferResult>;
}

/** Resolves spider do=pan descriptors through native cloud-drive APIs. */
export class DrivePanSharePlayback {
  constructor(private readonly ports: DrivePanSharePlaybackPorts) {}

  resolveKnownShareFile(url: string, flag: string, provider: NativeDriveProvider, episodeId: string, failures: string[]): Promise<PlayResult | null> {
    if (provider === 'baidu') return this.baiduFromPanUrl(url, flag, failures);
    if (provider === 'uc') return this.ucFromPanUrl(url, flag, failures, episodeId);
    return this.quarkFromPanUrl(url, flag, failures, episodeId);
  }

  resolveBaidu(url: string, flag: string, failures: string[], jvmPort: number | null, episodeId: string): Promise<PlayResult | null> {
    return this.baiduFromPanUrl(url, flag, failures, jvmPort, episodeId);
  }

  resolveUc(url: string, flag: string, failures: string[], episodeId: string): Promise<PlayResult | null> {
    return this.ucFromPanUrl(url, flag, failures, episodeId);
  }

  resolveQuark(url: string, flag: string, failures: string[], episodeId: string): Promise<PlayResult | null> {
    return this.quarkFromPanUrl(url, flag, failures, episodeId);
  }

  /**
   * jar 的 `do=pan` 代理地址里带**百度分享链接** → 走原生解链（成功返回播放结果，失败返回 null）。
   * 实测 jar 形态：`http://127.0.0.1:-1/proxy?do=pan&site=baidu&shareId=&fileId=<分享URL>&fileToken=`。
   * 这条兜底覆盖「episode id 本身不是分享链接、只有 jar 才知道要播哪个分享」的源。
   * ★ 2026-10-08：失败原因不再静默（`miss` 收集，调用处汇总落日志 + 上屏）——
   *   此前 extract 未命中/未绑定 Cookie 都静默 return null，用户日志里完全无迹可查。
   */
  private async baiduFromPanUrl(url: string, flag: string, miss?: string[], jvmPort?: number | null, episodeId = ''): Promise<PlayResult | null> {
    const share = extractBaiduShare(url) || extractBaiduShare(episodeId);
    const cookie = this.ports.cookie('baidu');
    const pan = parsePanProxyQuery(url);
    const fid = String(pan.fileId || '').trim();
    const sharedFile = extractBaiduSharedFile(episodeId) || extractBaiduSharedFile(url) ||
      (jvmPort && String(pan.site || '').toLowerCase().startsWith('baidu') && /^\d+$/.test(fid)
        ? await this.ports.readBaiduJvmContext(jvmPort, fid) : null);
    if (sharedFile) {
      if (!cookie) { miss?.push('百度：已识别分享文件但未绑定百度网盘 Cookie'); return null; }
      try {
        const t = await this.ports.resolveBaiduSharedFile(sharedFile, cookie);
        if (t.path) {
          this.ports.cleanup.enqueue({ provider: 'baidu', cookie, pdirFid: '', fid: '', path: t.path });
        }
        if (!t.ok || !t.url) { miss?.push(`百度：解链失败(${t.reason || '未知原因'})`); return null; }
        return { parse: 0, url: this.ports.wrapUrl(t.url, t.header), playUrl: '', flag, header: t.header, jx: 0 };
      } catch (e) { miss?.push(`百度：异常(${(e as Error).message.slice(0, 80)})`); return null; }
    }
    if (!share) {
      // ★ 2026-10-09：jar 反编译实证 —— `merge.b.j`（百度盘）把播放 id 传成**纯数字**（百度 `fs_id`，
      //   即 `?do=pan&site=baidu&shareId=&fileId=<fs_id>&fileToken=`）。桌面端此前「未识别分享链接」。
      //   未找到分享映射时才尝试本人盘 filemetas（不能把纯数字等同于已转存）。
      const site = String(pan.site || '').toLowerCase();
      if (!site.startsWith('baidu') || !/^\d{6,}$/.test(fid)) {
        // 「未识别」不逐通道 push（三通道会产出误导性双报）——由调用处统一给一条带 site 的原因。
        return null;
      }
      if (!cookie) {
        miss?.push('百度：已识别文件 ID（fs_id）但未绑定百度网盘 Cookie');
        return null;
      }
      try {
        const d = await this.ports.resolveBaiduByFsid(fid, cookie);
        if (!d.ok || !d.url) {
          this.ports.logger.w(`baiduTransfer(fs_id) 未成功(${d.reason || '未知原因'})`);
          miss?.push(`百度：解链失败(${d.reason || '未知原因'})`);
          return null;
        }
        this.ports.logger.i('baiduTransfer(fs_id) 直链 ok');
        return {
          parse: 0,
          url: this.ports.wrapUrl(d.url, d.header || {}),
          playUrl: '',
          flag,
          header: d.header || {},
          jx: 0,
        };
      } catch (e) {
        this.ports.logger.w(`baiduTransfer(fs_id) 异常: ${(e as Error).message}`);
        miss?.push(`百度：异常(${(e as Error).message.slice(0, 80)})`);
        return null;
      }
    }
    if (!cookie) {
      miss?.push('百度：已识别分享但未绑定百度网盘 Cookie');
      return null;
    }
    try {
      const t = await this.ports.resolveBaiduShare(share.short, share.pwd, cookie, {
        // ★ 2026-10-09：播放描述 JSON 里带 `path`（末段=文件名）→ 整季文件夹时按集名选对那一集
        innerFid: extractEpisodeFid(episodeId) || extractEpisodeFid(url) || (/^\d+$/.test(fid) ? fid : undefined),
        innerName: extractBaiduInnerName(episodeId) || extractEpisodeName(episodeId) || extractBaiduInnerName(url) || undefined,
      });
      if (t.path) {
        this.ports.cleanup.enqueue({ provider: 'baidu', cookie, pdirFid: '', fid: '', path: t.path });
      }
      if (!t.ok || !t.url) {
        this.ports.logger.w(`baiduTransfer(do=pan) 未成功(${t.reason || '未知原因'})`);
        miss?.push(`百度：解链失败(${t.reason || '未知原因'})`);
        return null;
      }
      this.ports.logger.i(`baiduTransfer(do=pan) 直链 ok（${t.path || ''}）`);
      return {
        parse: 0,
        url: this.ports.wrapUrl(t.url, t.header || {}),
        playUrl: '',
        flag,
        header: t.header || {},
        jx: 0,
      };
    } catch (e) {
      this.ports.logger.w(`baiduTransfer(do=pan) 异常: ${(e as Error).message}`);
      miss?.push(`百度：异常(${(e as Error).message.slice(0, 80)})`);
      return null;
    }
  }

  /**
   * jar 的 `do=pan` 代理地址里带 **UC 分享链接** → 走原生 ucResolveShare（成功返回播放结果，失败返回 null）。
   * 形态与百度同族：`http://127.0.0.1:-1/proxy?do=pan&type=2&site=uc&shareId=&fileId=<分享URL>&fileToken=`。
   * ★ 2026-10-08（用户报「UC 网盘资源无法播放」）：桌面端此前**只有百度**这一条兜底 ——
   *   jar 给 UC 分享的线路一律「视为无地址」→ 用户侧黑屏且无原因。这里补齐 UC 通道（免转存优先）。
   */
  private async ucFromPanUrl(url: string, flag: string, miss?: string[], episodeId = ''): Promise<PlayResult | null> {
    const pan = parsePanProxyQuery(url);
    const share = extractUcShare(episodeId, flag) || extractUcShare(url, flag) ||
      (/^uc/i.test(pan.site || '') && /^[0-9a-z_-]+$/i.test(pan.shareId || '')
        ? { pwdId: pan.shareId, passcode: pan.passcode || pan.pwd || '' } : null);
    if (!share) {
      // ★ 2026-10-09：「未识别」不再逐通道 push（同 baiduFromPanUrl，见其注释）。
      return null;
    }
    const cookie = this.ports.cookie('uc');
    if (!cookie) {
      miss?.push('UC：已识别分享但未绑定 UC 网盘 Cookie');
      return null;
    }
    try {
      // 分享 URL 与所选文件是两种不同标识；jar 可能只在原始选集描述中保留 fid/集名。
      const fileId = pan.fileId && !/[/:?]/.test(pan.fileId) ? pan.fileId : '';
      const t = await this.ports.resolveUcShare(share.pwdId, share.passcode, cookie, {
        innerFid: extractEpisodeFid(episodeId) || extractEpisodeFid(url) || fileId,
        innerName: extractEpisodeName(episodeId) || extractEpisodeName(url),
      });
      if (!t.ok || !t.url) {
        this.ports.logger.w(`ucTransfer(do=pan) 未成功(${t.reason || '未知原因'})`);
        miss?.push(`UC：解链失败(${t.reason || '未知原因'})`);
        return null;
      }
      if (t.fid) {
        this.ports.cleanup.enqueue({ provider: 'uc', cookie, pdirFid: t.pdirFid || '', fid: t.fid });
      }
      this.ports.logger.i('ucTransfer(do=pan) 取链成功');
      return {
        parse: 0,
        url: this.ports.wrapUrl(t.url, t.header || {}),
        playUrl: '',
        flag,
        header: t.header || {},
        jx: 0,
      };
    } catch (e) {
      this.ports.logger.w(`ucTransfer(do=pan) 异常: ${(e as Error).message}`);
      miss?.push(`UC：异常(${(e as Error).message.slice(0, 80)})`);
      return null;
    }
  }

  /**
   * ★ 2026-10-09（用户报部分线路「该线路需要网盘解链但未成功（百度：未识别分享链接；
   * UC：未识别分享链接）」）：jar 的 `do=pan` 代理地址里带**夸克分享链接**
   * （`site=quark&fileId=<pan.quark.cn/s/…>`）→ 走原生 quarkTransfer（转存 → 直链，
   * 落盘到「来自：分享」目录，播完即删——与 vm.play 前的夸克前置钩子同链路）。
   *   此前 do=pan 分发只有百度 / UC 两条通道：site=quark 的线路**必然双未识别**并上屏
   *   「百度：未识别；UC：未识别」（正是用户看到的文案）。
   */
  private async quarkFromPanUrl(url: string, flag: string, miss?: string[], episodeId = ''): Promise<PlayResult | null> {
    let share = extractQuarkShare(episodeId, flag) || extractQuarkShare(url, flag);
    let innerFid = extractEpisodeFid(episodeId) || extractEpisodeFid(url);
    const innerName = extractEpisodeName(episodeId) || extractEpisodeName(url);
    // ★ 2026-10-09：jar 的 `do=pan&site=quark` **不给分享 URL**，只给三个裸参数
    //   （实测：`shareId=e8ac5a87aa2e`（12 位 = pwd_id）、`fileId=2e3ad195….d30d`（32 位 = fid））。
    //   此前只认 `pan.quark.cn/s/<id>` → **必然「未识别」**（用户报「site=quark」播不了）。
    //   这里补「裸参数」通道：shareId 形如 pwd_id 就用它当 sId，fileId 形如 fid 就当目标文件。
    if (!share) {
      const pan = parsePanProxyQuery(url);
      const sid = String(pan.shareId || '').trim();
      const fid = String(pan.fileId || '').trim();
      if (/^quark/i.test(pan.site || '') && /^[0-9a-f]{10,}$/i.test(sid)) {
        share = { sId: sid, passcode: '' };
        if (!innerFid && /^[0-9a-f]{20,}$/i.test(fid)) innerFid = fid;
      }
    }
    if (!share) {
      // 「未识别」不逐通道 push（同 baiduFromPanUrl 注释）。
      return null;
    }
    const cookie = this.ports.cookie('quark');
    if (!cookie) {
      miss?.push('夸克：已识别分享但未绑定夸克网盘 Cookie');
      return null;
    }
    try {
      const t = await this.ports.resolveQuarkShare(share.sId, cookie, {
        passcode: share.passcode,
        innerFid,
        innerName,
      });
      if (!t.ok || !t.url) {
        this.ports.logger.w(`quarkTransfer(do=pan) 未成功(${t.reason || '未知原因'})`);
        miss?.push(`夸克：解链失败(${t.reason || '未知原因'})`);
        return null;
      }
      if (t.fid) {
        this.ports.cleanup.enqueue({ cookie, pdirFid: t.pdirFid || '', dirFid: t.pdirFid || '', fid: t.fid });
      }
      this.ports.logger.i(`quarkTransfer(do=pan) 直链 ok: ${t.url.slice(0, 90)}...`);
      // 与前置钩子一致：直链必须经 /play 中继注入 Cookie/Referer/UA（缺会被 CDN 拒绝）
      return {
        parse: 0,
        url: this.ports.wrapUrl(t.url, t.header || {}),
        playUrl: '',
        flag,
        header: t.header || {},
        jx: 0,
      };
    } catch (e) {
      this.ports.logger.w(`quarkTransfer(do=pan) 异常: ${(e as Error).message}`);
      miss?.push(`夸克：异常(${(e as Error).message.slice(0, 80)})`);
      return null;
    }
  }

}

import type { Logger, ParseBean, PlayResult, SourceBean } from '../../shared/types';
import { driveBindProviderFromText, driveProviderLabel, looksLikeDriveBindFailure, matchDriveCookieProvider, wrapPlayUrl, wrapPlayUrlWithHeaders } from '../../shared/driveProvider';
import { isHlsPlaylistUrl } from '../../shared/playbackResult';
import { classifyPlayLink } from '../../engine/vod/playLink';
import { LOCAL_PROXY_BASE } from '../../shared/constants';
import type { SourceExecutionContextValue } from './SourceExecutionContext';
import { resolveSpiderPanProxyPlayback as resolveSpiderPanProxyPlaybackUseCase } from './SpiderPanProxyPlayback';

type NativeDriveProvider = 'quark' | 'uc' | 'baidu';

export interface NativeDriveSharePlaybackPort {
  resolve(id: string, flag: string): Promise<{
    result: PlayResult | null;
    failures: Record<NativeDriveProvider, string>;
  }>;
}

export interface DrivePanSharePlaybackPort {
  resolveBaidu(url: string, flag: string, failures: string[], jvmPort: number | null, episodeId: string): Promise<PlayResult | null>;
  resolveUc(url: string, flag: string, failures: string[], episodeId: string): Promise<PlayResult | null>;
  resolveQuark(url: string, flag: string, failures: string[], episodeId: string): Promise<PlayResult | null>;
}

export interface SelfResolveMediaProbePort {
  probe(url: string): Promise<boolean>;
}

export interface PlaybackParseFallbackPort {
  resolve(result: PlayResult, parses?: ParseBean[]): Promise<PlayResult>;
}

export type TorrentPlaybackOutcome =
  | { kind: 'inline'; url: string; title: string }
  | { kind: 'external'; player: string; title: string }
  | { kind: 'unsupported'; reason: string };

export interface TorrentPlaybackPort {
  open(magnet: string): Promise<TorrentPlaybackOutcome>;
}

export interface SpiderPlaybackPorts {
  playSpider(source: SourceBean, flag: string, id: string, vipFlags: string[]): Promise<PlayResult>;
  proxyPortFor(source: SourceBean): number | null;
  nativeDriveSharePlayback: NativeDriveSharePlaybackPort;
  panSharePlayback: DrivePanSharePlaybackPort;
  logger: Pick<Logger, 'i' | 'w'>;
  vipFlags(): string[];
  driveTokens(): Record<string, string>;
  markDriveBindNeeded(key: string): void;
  driveBindProviderForGenericAuth(message: string, key: string): string | null;
  rememberDriveBindProvider(key: string, provider: string): void;
  syncDriveFiles(): void;
  resetSpidersAfterDriveChange(): void;
  baiduShareCode(url: string): string;
  hasQuarkShare(url: string): boolean;
  selfResolveMediaProbe: SelfResolveMediaProbePort;
  isBaiduPanDescriptor(url: string): boolean;
  playbackParseFallback: PlaybackParseFallbackPort;
  torrentPlay(): TorrentPlaybackPort | undefined;
}

/** Playback use case: translate a source result into a desktop-playable result. */
export class SpiderPlaybackService {
  constructor(private readonly ports: SpiderPlaybackPorts) {}

  execute(
    key: string,
    flag: string,
    id: string,
    context: SourceExecutionContextValue,
    source: SourceBean,
  ): Promise<PlayResult> {
    return this.playInner(key, flag, id, source, context);
  }
  private async playInner(
    key: string,
    flag: string,
    id: string,
    b: SourceBean,
    context: SourceExecutionContextValue,
    retried = false,
  ): Promise<PlayResult> {
    const nativeShare = await this.ports.nativeDriveSharePlayback.resolve(id, flag);
    if (nativeShare.result) return nativeShare.result;
    const quarkFail = nativeShare.failures.quark;
    const ucFail = nativeShare.failures.uc;
    const bdFail = nativeShare.failures.baidu;
    return this.ports.playSpider(b, flag, id, context.config?.flags || this.ports.vipFlags()).then(async (r) => {
      // Custom CatVod handlers (for example Adm3u8) belong to the JVM that
      // produced the address. The bare app /proxy route only owns built-ins.
      const localProxy = /^http:\/\/(?:127\.0\.0\.1|localhost):(?:9978|-1)\/proxy\?([^#]*)$/i.exec(r.url || '');
      if (localProxy) {
        const handler = new URLSearchParams(localProxy[1]).get('do') || '';
        if (['m3u8', 'Adm3u8'].includes(handler)) {
          r.url = LOCAL_PROXY_BASE + '/proxy?' + localProxy[1];
        }
        if (handler && !['pan', 'm3u8', 'Adm3u8', 'live', 'ck', 'py'].includes(handler)) {
          const port = this.ports.proxyPortFor(b);
          if (!port || !Number.isInteger(port) || port < 1024 || port > 65535) {
            return { ...r, parse: 1, url: '', playUrl: '', message: '该片源的蜘蛛媒体代理未就绪，请重新打开片源后重试' };
          }
          r.url = LOCAL_PROXY_BASE + '/proxy/' + port + '?' + localProxy[1];
          this.ports.logger.i('play: 蜘蛛媒体代理已接入 JVM do=' + handler + ': ' + key);
        }
      }
      const panPlaybackResult = await resolveSpiderPanProxyPlaybackUseCase(r, key, flag, id, b, {
        logger: this.ports.logger,
        isBaiduDescriptor: this.ports.isBaiduPanDescriptor,
        baiduShareCode: this.ports.baiduShareCode,
        hasQuarkShare: this.ports.hasQuarkShare,
        proxyPortFor: (source) => this.ports.proxyPortFor(source),
        probeSelfResolveUrl: (url) => this.ports.selfResolveMediaProbe.probe(url),
        resolveBaidu: (url, playFlag, failures, jvmPort, episodeId) =>
          this.ports.panSharePlayback.resolveBaidu(url, playFlag, failures, jvmPort, episodeId),
        resolveUc: (url, playFlag, failures, episodeId) =>
          this.ports.panSharePlayback.resolveUc(url, playFlag, failures, episodeId),
        resolveQuark: (url, playFlag, failures, episodeId) =>
          this.ports.panSharePlayback.resolveQuark(url, playFlag, failures, episodeId),
      });
      if (panPlaybackResult) return panPlaybackResult;
      // ★ 2026-09-29：协议识别（用户选定「先做 A：协议解析 + 链路识别」）
      //   · thunder:// → 解出内层 http(s) 直链，替换后用既有链路播（此前原样交给 <video> ⇒ 黑屏）；
      //   · magnet/ed2k/ftp → 无载体：{url:'', parse:1, message} 上屏原因 + externalLink（IPC 层复制剪贴板）。
      const link = classifyPlayLink(r.url || '');
      if (link.unsupported) {
        // ★ 2026-09-29（磁力 B）：磁力不再直接判死 —— 先交内置 BT 引擎（aria2c）起播；
        //   引擎缺失/冷门无做种/无外部播放器才回到 A 的「人话提示 + 复制链接」兜底。
        if (link.kind === 'magnet') return this.tryMagnetPlay(link.externalLink || r.url || '', link.unsupported, r);
        this.ports.logger.w(`play: 链接无桌面载体（${link.kind}）→ 上屏引导: ${key}`);
        return { ...r, parse: 1, url: '', playUrl: '', message: link.unsupported, externalLink: link.externalLink };
      }
      if (link.url && link.url !== r.url) {
        this.ports.logger.i(`play: thunder 链接解出内层地址（${link.url.slice(0, 60)}…）: ${key}`);
        r = { ...r, url: link.url };
      }
      // ★ 2026-09-28（诊断实测发现，用户第 6 项的一类）：蜘蛛把「未登录网盘」当成
      //   **空地址 + 一句提示**返回（`parse:0`），而渲染层只认 `parse:1` 才上屏原因 →
      //   表现为「点了播放没反应/黑屏」，用户不知道要绑网盘。
      //   实测原话：`还未登录百度账号,请前往【配置中心】登录`（至臻源 · 百度线路）。
      //   这里翻译成「去绑定该网盘」的既有通道（parse:1 + needDriveCookieBind + message）。
      //   ★★ 2026-09-30（用户报「潇洒/摸鱼这类配置，网盘资源播不了、已绑定还每次都弹绑定窗」）：
      //     **必须先看本地绑定态** —— 已绑定却收到「需登录」的提示，说明是**常驻蜘蛛的旧状态**
      //     （cookie 文件在它 init 之后才写入 / `%TEMP%` 被系统清理过 / 绑定前的实例仍被复用）；
      //     此时正确动作是「重置蜘蛛池并重试一次」而不是让用户去绑定（他会看到永远弹的绑定窗）。
      if (!r.url && r.message) {
        const prov =
          driveBindProviderFromText(String(r.message)) ||
          this.ports.driveBindProviderForGenericAuth(String(r.message), key);
        if (prov) {
          this.ports.markDriveBindNeeded(key);
          const bound = !!String(this.ports.driveTokens()[prov] || '').trim();
          if (bound && !retried) {
            this.ports.logger.w(`play: 蜘蛛称「需登录${prov}」但本地已绑定 → 重置蜘蛛池并重试一次: ${key}`);
            // ★ 2026-10-09：重试前**补写各系 cookie 文件**（wex 系读 `<沙箱>/files/TV/.quarkcookie` 等；
            //   沙箱/%TEMP% 被清缓存清掉、或旧版本从未写过时，这一步自愈），再重置池让新 JVM 读到。
            this.ports.syncDriveFiles();
            this.ports.resetSpidersAfterDriveChange();
            return this.playInner(key, flag, id, b, context, true);
          }
          if (bound) {
            if (prov === 'uc' && /\[uc\]\(auth\)/i.test(String(r.message))) {
              // Preserve the spider's authentication diagnostic. It proves
              // the retry reached the UC auth path, so translating it into a
              // generic invalid-share message would hide the real failure.
              return r;
            }
            // ★ 2026-10-09（用户报「还未登录夸克账号」类文案定位需要）：日志落**原文全文**（上屏仍截 100 字）
            //   —— 不同 jar 家族的「未登录」文案措辞不同（如 fty「接口列表配置中心」/ wex「还没有配置夸克
            //   Cookie」/ 未知族「【配置中心】」），全文是判定 jar 家族与读取通道的第一手证据。
            this.ports.logger.w(
              `play: 重试后蜘蛛仍称需登录「${prov}」→ 如实上屏（不再弹绑定窗）: ${key} | 原文=${String(r.message).slice(0, 300)}`,
            );
            return {
              ...r,
              parse: 1,
              message:
                `该源取流失败（「${driveProviderLabel(prov)}」已绑定，无需重复绑定）：` +
                `${String(r.message).slice(0, 100)}。多为源侧分享失效/该集已不在分享内，建议换线路或换源。`,
            };
          }
          this.ports.logger.w(`play: 蜘蛛返回空地址且提示需登录「${prov}」→ 翻译为绑定提示: ${key}`);
          return {
            ...r,
            parse: 1,
            needDriveCookieBind: prov,
            message: `该源播放需要${driveProviderLabel(prov)}账号：请在点播页点「网盘绑定」绑定后重新播放（源提示：${r.message}）`,
          };
        }
      }
      // 仅对单个 http(s) 且非多段（# 连接）的播放地址做中继包装
      const single = /^https?:\/\//i.test(r.url || '') && !(r.url || '').includes('#');
      if (!single || !r.url) {
        // ★ 2026-09-29：蜘蛛连地址都没给（`url:''`）但**集地址本身就是磁力/电驴**（部分源把磁力写在
        //   vod_play_url 里，播放方法直接返回空）→ 按 id 再识别一次，给出同一套上屏引导。
        if (!r.url) {
          const byId = classifyPlayLink(id);
          if (byId.unsupported) {
            if (byId.kind === 'magnet') return this.tryMagnetPlay(byId.externalLink || id, byId.unsupported, r);
            this.ports.logger.w(`play: 集地址无桌面载体（${byId.kind}）→ 上屏引导: ${key}`);
            return { ...r, parse: 1, url: '', playUrl: '', message: byId.unsupported, externalLink: byId.externalLink };
          }
        }
        // ★ 2026-09-29：夸克转存失败 + 蜘蛛也没给出地址（或给的地址不可用）→ 把原因上屏，
        //   不让用户对着黑屏猜（原来原因只写在日志里）。
        if (!r.url && quarkFail) {
          const needLogin = /401|403|未登录|登录已|login/i.test(quarkFail);
          if (needLogin) this.ports.markDriveBindNeeded(key);
          this.ports.logger.w(`play: 夸克转存失败且蜘蛛无地址 → 上屏原因: ${key} — ${quarkFail}`);
          return {
            ...r,
            parse: 1,
            url: '',
            playUrl: '',
            ...(needLogin ? { needDriveCookieBind: 'quark' } : {}),
            message: needLogin
              ? `夸克登录已失效：请重新登录「夸克」后再播（转存失败原因：${quarkFail.slice(0, 80)}）`
              : `夸克转存失败：${quarkFail}（分享可能已失效/更新，或该集文件已不在分享内 —— 建议换线路或换源）`,
          };
        }
        // ★ 2026-09-30：UC 解链失败 + 蜘蛛也没给出可用地址 → 同样把原因上屏（不让用户对着黑屏猜）
        if (!r.url && ucFail) {
          const needLogin = /401|403|未登录|登录已|login/i.test(ucFail);
          if (needLogin) this.ports.markDriveBindNeeded(key);
          this.ports.logger.w(`play: UC 解链失败且蜘蛛无地址 → 上屏原因: ${key} — ${ucFail}`);
          return {
            ...r,
            parse: 1,
            url: '',
            playUrl: '',
            ...(needLogin ? { needDriveCookieBind: 'uc' } : {}),
            message: needLogin
              ? `UC 登录已失效：请重新登录「UC 网盘」后再播（原因：${ucFail.slice(0, 80)}）`
              : `UC 网盘取流失败：${ucFail}（分享可能已失效/更新，或网盘空间不足 —— 建议换线路或换源）`,
          };
        }
        // ★ 2026-09-30：百度解链失败 + 蜘蛛也没给出可用地址 → 同样把原因上屏
        if (!r.url && bdFail) {
          const needLogin = /401|403|未登录|登录已|login|bdstoken/i.test(bdFail);
          if (needLogin) this.ports.markDriveBindNeeded(key);
          this.ports.logger.w(`play: 百度解链失败且蜘蛛无地址 → 上屏原因: ${key} — ${bdFail}`);
          return {
            ...r,
            parse: 1,
            url: '',
            playUrl: '',
            ...(needLogin ? { needDriveCookieBind: 'baidu' } : {}),
            message: needLogin
              ? `百度登录已失效：请重新登录「百度网盘」后再播（原因：${bdFail.slice(0, 80)}）`
              : `百度网盘取流失败：${bdFail}（分享可能已失效/更新，或网盘空间不足 —— 建议换线路或换源）`,
          };
        }
        return r;
      }
      // 1) 蜘蛛显式返回播放 header（Cookie/UA/Referer）→ 优先通过 /play 注入（网盘源关键）
      if (r.header && Object.keys(r.header).length > 0) {
        r.url = wrapPlayUrlWithHeaders(r.url, r.header);
        return r;
      }
      // 2) 否则按网盘域名注入对应 provider 的绑定 Cookie
      const prov = matchDriveCookieProvider(r.url);
      if (prov) {
        // ★ 2026-09-27：本源真实产出了网盘直链 ⇒ **确定需要网盘绑定** → 学会它。
        //   这样源主页的「网盘绑定」入口不依赖蜘蛛类名清单（摸鱼/fty 类名写法不同、
        //   同一只蜘蛛在不同订阅里 ext 也不同），换任何订阅、任何新蜘蛛都能覆盖。
        // ★ 2026-10-14：同时记住该源的 provider（供泛化授权文案补位，见 driveBindProviderForGenericAuth）
        this.ports.rememberDriveBindProvider(key, prov);
        this.ports.markDriveBindNeeded(key);
        const tokens = this.ports.driveTokens();
        /**
         * ★★ 2026-09-29（用户要求）：**未绑定就拦下这次播放**，让渲染层直接弹「网盘绑定」窗口 ★★
         *
         * 旧行为：把（无 Cookie 必然 401 的）网盘直链仍交给播放器 → 用户看到黑屏 + 一句提示，
         *   还得自己找「点播页 → 网盘绑定」入口；现在改为走既有通道 `parse:1 + needDriveCookieBind`，
         *   详情页/播放器窗口据此**自动弹出**对应网盘的绑定弹窗（预选该网盘），绑定成功自动重播。
         * 依据：夸克/UC/百度/115 直链无绑定 Cookie 必失败（见 docs 与 §C 的既有结论）。
         */
        if (!tokens[prov]) {
          this.ports.logger.w(`play: 网盘直链但未绑定「${prov}」→ 拦下本次播放并提示绑定: ${key}`);
          return {
            url: '',
            parse: 1,
            playUrl: '',
            flag,
            jx: 0,
            needDriveCookieBind: prov,
            message: `该资源来自「${driveProviderLabel(prov)}」的专用链接，需要先绑定该网盘 Cookie 才能取流播放`,
          } as PlayResult;
        }
        r.url = wrapPlayUrl(r.url, prov);
      } else if (isHlsPlaylistUrl(r.url)) {
        // Raw HLS links otherwise go straight from Chromium to the remote host:
        // CORS, relative segment URLs, and source response status then bypass
        // the local relay. Relay them even when the spider supplied no headers.
        r.url = wrapPlayUrlWithHeaders(r.url, r.header || {});
      }
      return r;
      }).then((r) => this.ports.playbackParseFallback.resolve(r, context.config?.parses as ParseBean[] | undefined)).catch((e) => {
      // ★ 2026-09-27（缺口 B，别删）：**未绑定网盘 Cookie 时的失败要翻译成「去绑定」**。
      //   实测 wex 玩偶（夸克盘）：蜘蛛抛 `org.json.JSONException: JSONObject["data"] not found.`
      //   —— 上游网盘接口无 Cookie 时回的是错误 JSON（没有 data 字段），蜘蛛没做兜底。
      //   这里同时做两件事：① 记入绑定清单（学到的判据不依赖类名清单）；② 把失败变成一条**可执行的中文提示**
      //   走既有上屏通道（`parse:1` + `message`，PlayerPage 会在播放器上方显示，并保底播原始地址）
      //   —— 不能 `throw`：渲染层的 catch 只回退原始地址，用户看不到任何原因。
      const msg = String((e as Error)?.message ?? e);
      if (looksLikeDriveBindFailure(msg)) {
        this.ports.markDriveBindNeeded(key);
        // ★ 2026-09-30：已绑定该网盘时不再引导「去绑定」（否则用户会以为绑定没生效）
        // ★ 2026-10-14：泛化授权文案（如「请先完成网盘授权」）不含网盘名 → 用该源学到的 provider 补位，
        //   否则 prov='' 会把「已绑定」误判成「未绑定」并错误引导用户去绑定。
        const prov = driveBindProviderFromText(msg) || this.ports.driveBindProviderForGenericAuth(msg, key) || '';
        const bound = !!String(this.ports.driveTokens()[prov] || '').trim();
        // ★ 2026-10-14：与「返回空地址 + 需登录文案」同口径 —— 已绑定却抛授权错，说明是**常驻蜘蛛的旧状态**
        //   （cookie 文件在它 init 之后才写入 / `%TEMP%` 被清理过 / 旧实例仍被复用）→ 补写 cookie 文件 +
        //   重置蜘蛛池后**重试一次**（`retried` 防死循环），而不是直接判死。
        if (bound && !retried) {
          this.ports.logger.w(`play: 蜘蛛抛网盘授权错但本地已绑定 → 重置蜘蛛池并重试一次: ${key} — ${msg.slice(0, 160)}`);
          this.ports.syncDriveFiles();
          this.ports.resetSpidersAfterDriveChange();
          return this.playInner(key, flag, id, b, context, true);
        }
        this.ports.logger.w(`play 判定需要网盘 Cookie（已记入绑定清单${bound ? '；该网盘已绑定' : ''}）: ${key} — ${msg}`);
        return {
          url: '',
          parse: 1,
          playUrl: '',
          flag,
          jx: 0,
          message: bound
            ? `该源取流失败（「${driveProviderLabel(prov)}」已绑定，无需重复绑定）：${msg.slice(0, 120)}`
            : '该源播放需要网盘 Cookie：请在点播页点「网盘绑定」填写账号（夸克 / UC / 百度 / 115）后重新播放',
        } as PlayResult;
      }
      throw e;
    });
  }

  private async tryMagnetPlay(magnet: string, reason: string, r: PlayResult): Promise<PlayResult> {
    const engine = this.ports.torrentPlay();
    const fallback = (why: string): PlayResult => {
      this.ports.logger.w(`play: 磁力未能起播（${why}）→ 复制链接兜底`);
      return {
        ...r,
        parse: 1,
        url: '',
        playUrl: '',
        message: `${why}。磁力链接已复制到剪贴板，可用 qBittorrent / 迅雷 / Motrix 等工具下载播放`,
        externalLink: magnet,
      };
    };
    if (!engine) return fallback(reason);
    try {
      const out = await engine.open(magnet);
      if (out.kind === 'inline') {
        this.ports.logger.i(`play: 磁力起播（BT 内联）「${out.title}」→ ${out.url}`);
        return { ...r, parse: 0, url: out.url, playUrl: '', header: undefined };
      }
      if (out.kind === 'external') {
        this.ports.logger.i(`play: 磁力起播（外部播放器「${out.player}」）「${out.title}」`);
        return {
          ...r,
          parse: 1,
          url: '',
          playUrl: '',
          message: `已用「${out.player}」打开播放（该格式浏览器不支持，交给外部播放器边下边播）`,
        };
      }
      return fallback(out.reason);
    } catch (e) {
      return fallback(`BT 引擎异常（${(e as Error).message.slice(0, 60)}）`);
    }
  }


}

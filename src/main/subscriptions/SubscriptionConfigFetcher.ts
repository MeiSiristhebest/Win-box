import type { HttpClient, Logger } from '../../shared/types';
import type { LocalPkgAccess } from '../store/LocalPkgStore';
import { parsePkgUrl } from '../../engine/config/localPkg';
import { looksLikeSubscribeJson, fixContentPath } from '../../engine/config/ApiConfigParser';
import { describeFailures, disguiseLadder, fetchWithDisguise, looksEncrypted, siteRootOf, sniffBody } from '../../engine/util/fetchWithDisguise';
import { extractStegoConfig, looksLikeImage } from '../../engine/util/imageStego';
import { extractDisguiseConfig } from '../../engine/config/disguiseConfig';
import { tryDecryptConfig } from '../net/configDecrypt';
import { SUBSCRIPTION_IMPORT_POLICY } from './ImportPolicy';

/** Fetches and decodes subscription text without changing any profile or active configuration. */
export async function fetchSubscriptionConfig(dependencies: { http: HttpClient; logger: Logger; localPkgs?: LocalPkgAccess }, url: string, quick = false, signal?: AbortSignal): Promise<{ text: string; hint: string }> {
    if (signal?.aborted) throw signal.reason ?? new Error('导入已取消');
    // ★ 2026-09-29（用户要求）本地包：`pkg://<i>/<rel>` —— 不联网，直接读包内订阅文本。
    //   文本已由 LocalPkgStore.readSubscription 用 rewritePkgPaths 展开相对路径（"/pkg" 或 file://），
    //   因此后续 parseSiteConfigWithBase 不需要（也不应）再做 http 相对展开。
    //   包被移动/删除时给出可执行提示（重新导入该包）。
    const pkgRef = parsePkgUrl(url);
    if (pkgRef) {
      const got = dependencies.localPkgs?.readSubscription(pkgRef.index, pkgRef.rel);
      if (!got) {
        return { text: '', hint: '本地包未登记或包内订阅文件已不存在（包目录被移动/删除？）—— 请在配置页重新「导入本地包」。' };
      }
      for (const w of got.warnings) dependencies.logger.w(`本地包：${w}`);
      dependencies.logger.i(`本地包订阅读取：${url} → ${got.text.length}B`);
      return { text: got.text, hint: '' };
    }
    const timeoutMs = quick
      ? SUBSCRIPTION_IMPORT_POLICY.requestTimeoutMs.quick
      : SUBSCRIPTION_IMPORT_POLICY.requestTimeoutMs.standard;
    // Keep each child bounded by the batch signal, but do not equate a UA-only
    // scan with unavailability: some subscriptions require a Referer/session.
    const attempts = disguiseLadder({ referer: siteRootOf(url) });
    const isSubJson = (b: Buffer): boolean => looksLikeSubscribeJson(b.toString('utf-8'));
    const res = await fetchWithDisguise(dependencies.http, url, {
      accept: isSubJson,
      tryGitHubOrigin: true,
       attempts: quick ? attempts.slice(0, SUBSCRIPTION_IMPORT_POLICY.maxQuickAttempts) : attempts,
      timeoutMs,
      signal,
      onTry: (t) => {
        const feat = [t.status ? `HTTP ${t.status}` : '', t.sniff ? `${t.sniff.kind} ${t.sniff.size}B` : '', t.reason || '']
          .filter(Boolean)
          .join(' · ');
        dependencies.logger.i(`订阅尝试「${t.label}」${t.ok ? '命中' : '未命中'}：${feat} ← ${t.url}`);
      },
    });
    const normalizeOriginPaths = (text: string): string => res.originUrl ? fixContentPath(res.originUrl, text) : text;
    if (res.buf) {
      if (res.used && res.used.label !== '默认 UA') dependencies.logger.i(`订阅按「${res.used.label}」取到内容：${url}`);
      if (res.altUrl) dependencies.logger.i(`订阅换协议后取到内容（${res.altUrl}）：${url}`);
      const text = res.buf.toString('utf-8');
      if (res.originUrl) dependencies.logger.i(`订阅代理未命中，已从 GitHub 原站读取：${res.originUrl}`);
      return { text: normalizeOriginPaths(text), hint: '' };
    }
    // ★ 2026-09-29：图片尾部隐写（饭太硬防直连；参照 CatClawVideo TvBoxSubscriptionManager.cs:548）。
    //   必须拿**原始字节**试 —— 先转 utf-8 字符串会把二进制毁成替换字符，载荷就找不回来了。
    const stego = res.last ? extractStegoConfig(res.last) : null;
    if (stego) {
      dependencies.logger.i(`订阅图片尾部隐写：已提取配置（${stego.kind}，尾段 ${stego.offset} 起，${stego.text.length}B）：${url}`);
      return { text: normalizeOriginPaths(stego.text), hint: '' };
    }
    const raw = res.last ? res.last.toString('utf-8') : '';
    // ★ 2026-10-15：**伪装体**兜底（例 `https://yc.wya6.cn/wykj.php`）—— 真体整段是一个 jar 的
    //   十六进制 dump，真配置藏在末行 ASCII 列的 `=XXX**` 标记之后（base64）。属「本地可解释」手段，
    //   故排在图片隐写之后、第三方解密服务之前（见 disguiseConfig.ts 头注释）。
    const disguise = extractDisguiseConfig(raw);
    if (disguise) {
      dependencies.logger.i(
        `订阅伪装体：已提取配置（${disguise.how}${disguise.marker ? `，marker=${disguise.marker}` : ''}，` +
          `载荷起于 ${disguise.offset}，${disguise.text.length}B）：${url}`,
      );
      return { text: normalizeOriginPaths(disguise.text), hint: '' };
    }
    // ★ 解密兜底：本地编码优先，其次第三方解密服务（仅此处、且仅在所有伪装手段失败后）
    const dec = await tryDecryptConfig(dependencies.http, url, raw, dependencies.logger, signal);
    if (dec) return { text: normalizeOriginPaths(dec.text), hint: '' };
    const encrypted = res.last ? looksEncrypted(res.last) : false;
    const image = res.last ? looksLikeImage(res.last) : false;
    const sn = res.last ? sniffBody(res.last) : null;
    const hint = '本次未能取得有效订阅配置，尚不能判定其中的影片源永久不可用。' +
      (encrypted ? '该地址返回的内容疑似**加密配置**（普通客户端无法直接使用）。' : '') +
      (image ? '该地址返回的是**图片**（疑似图片尾部隐写，但未从中提取到配置）。' : '') +
      (sn?.kind === 'dump'
        ? '该地址返回的是**十六进制 dump 伪装体**（真配置通常藏在尾部 `=XXX**` 标记之后，但本次未能提取）。'
        : '') +
      (sn ? `最后响应为 ${sn.kind}（${sn.size}B）${sn.head ? `，开头是「${sn.head.slice(0, 60)}」` : ''}。` : '所有尝试都没有拿到响应体。') +
      `已尝试：${describeFailures(res.tries)}`;
    return { text: normalizeOriginPaths(raw), hint };
  }

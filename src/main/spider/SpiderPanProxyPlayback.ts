import type { Logger, PlayResult, SourceBean } from '../../shared/types';
import { driveProviderLabel } from '../../shared/driveProvider';
import { parsePanProxyQuery } from './panProxyDescriptor';

/** Infrastructure ports used by the spider-specific pan proxy use case. */
export interface SpiderPanProxyPlaybackPorts {
  logger: Pick<Logger, 'i' | 'w'>;
  isBaiduDescriptor(url: string): boolean;
  baiduShareCode(url: string): string;
  hasQuarkShare(url: string): boolean;
  proxyPortFor(source: SourceBean): number | null | undefined;
  probeSelfResolveUrl(url: string): Promise<boolean>;
  resolveBaidu(
    url: string,
    flag: string,
    failures: string[],
    jvmPort: number | null,
    episodeId: string,
  ): Promise<PlayResult | null>;
  resolveUc(url: string, flag: string, failures: string[], episodeId: string): Promise<PlayResult | null>;
  resolveQuark(url: string, flag: string, failures: string[], episodeId: string): Promise<PlayResult | null>;
}

/**
 * Resolves the JVM-only do=pan descriptor returned by a spider. It owns the
 * descriptor policy and fallback order; network, JVM, and logging effects sit
 * behind ports so the decision flow can be exercised without Electron.
 */
export async function resolveSpiderPanProxyPlayback(
  result: PlayResult,
  key: string,
  flag: string,
  episodeId: string,
  source: SourceBean,
  ports: SpiderPanProxyPlaybackPorts,
): Promise<PlayResult | null> {
  const url = String(result.url || '');
  const panJson = !!url && ports.isBaiduDescriptor(url);
  const isPanProxy = /[?&]do=pan\b/i.test(url);
  const isJvmLocalProxy = /127\.0\.0\.1:-1/i.test(url);
  if (!url || (!isPanProxy && !isJvmLocalProxy && !panJson)) return null;

  const pan = parsePanProxyQuery(url);
  const panKeys = Object.keys(pan).join(',');
  if (panJson) {
    ports.logger.w(
      'play: 蜘蛛返回「百度网盘播放描述 JSON」→ 走原生解链: ' + key +
        ' | surl=' + ports.baiduShareCode(url).slice(0, 40),
    );
  } else {
    ports.logger.w(
      'play: 蜘蛛返回桌面端无路由的网盘代理地址（do=pan）→ 视为无地址: ' + key +
        ' | keys=' + panKeys +
        ' | site=' + (pan.site || '-') +
        ' | shareId=' + String(pan.shareId || '-').slice(0, 40) +
        ' | fileId=' + String(pan.fileId || '-').slice(0, 140),
    );
  }

  let jvmPort: number | null = null;
  try {
    jvmPort = ports.proxyPortFor(source) ?? null;
  } catch {
    jvmPort = null;
  }
  if (jvmPort && !/^quark/i.test(pan.site || '') && !ports.hasQuarkShare(url)) {
    const localProxy = /^http:\/\/127\.0\.0\.1:(?:9978|-1)\/proxy\?/i.exec(url);
    if (localProxy) {
      const rewritten = url.replace(localProxy[0], 'http://127.0.0.1:9978/proxy/' + jvmPort + '?');
      ports.logger.i(
        'play: 网盘/代理地址改写 → 蜘蛛 JVM 自解链(/proxy/' + jvmPort + ') do=' +
          (pan.do || '-') + ' site=' + (pan.site || '-') + ': ' + key,
      );
      if (await ports.probeSelfResolveUrl(rewritten)) {
        return { ...result, parse: 0, url: rewritten, playUrl: '', jx: 0 };
      }
      ports.logger.w('play: jar 自解链预检不通过 → 原生通道兜底: ' + key);
    } else if (panJson) {
      const shareId = /"share_id"\s*:\s*"([0-9a-zA-Z_-]+)"/.exec(url)?.[1] || '';
      const fsId = /"fs_id"\s*:\s*"([0-9]+)"/.exec(url)?.[1] || '';
      if (fsId) {
        const query =
          'do=pan&type=2&site=baidu&shareId=' + encodeURIComponent(shareId) +
          '&fileId=' + fsId + '&fileToken=';
        const synthetic = 'http://127.0.0.1:9978/proxy/' + jvmPort + '?' + query;
        ports.logger.i(
          'play: 百度描述 JSON → 合成 do=pan 交 jar 自解链(/proxy/' + jvmPort +
            ') share_id=' + shareId.slice(0, 24) + ' fs_id=' + fsId.slice(0, 24) + ': ' + key,
        );
        if (await ports.probeSelfResolveUrl(synthetic)) {
          return { ...result, parse: 0, url: synthetic, playUrl: '', jx: 0 };
        }
        ports.logger.w('play: 描述 JSON 合成 do=pan 预检不通过 → 原生通道兜底: ' + key);
      }
    } else {
      ports.logger.w('play: 拿到 JVM 端口但该地址无法自解链（非代理/描述形态）→ 原生通道: ' + key);
    }
  } else {
    ports.logger.w('play: 拿不到该源 JVM 端口（蜘蛛未被调用过/非 jar 源）→ 原生解链兜底: ' + key);
  }

  const site = String(pan.site || '').toLowerCase();
  const failures: string[] = [];
  const order: Array<'baidu' | 'uc' | 'quark'> = site.startsWith('quark')
    ? ['quark', 'baidu', 'uc']
    : site.startsWith('baidu')
      ? ['baidu', 'uc', 'quark']
      : site.startsWith('uc')
        ? ['uc', 'baidu', 'quark']
        : ['baidu', 'uc', 'quark'];
  for (const provider of order) {
    const resolved =
      provider === 'baidu'
        ? await ports.resolveBaidu(url, flag, failures, jvmPort, episodeId)
        : provider === 'uc'
          ? await ports.resolveUc(url, flag, failures, episodeId)
          : await ports.resolveQuark(url, flag, failures, episodeId);
    if (resolved) return resolved;
  }
  if (!failures.length) failures.push('未识别分享链接（site=' + (site || '未知') + '）');

  const bindFailure = failures.find((failure) => failure.includes('未绑定')) || '';
  const provider = bindFailure.startsWith('百度')
    ? 'baidu'
    : bindFailure.startsWith('UC')
      ? 'uc'
      : bindFailure.startsWith('夸克')
        ? 'quark'
        : '';
  ports.logger.w('play: do=pan 原生解链均未成功（' + failures.join('；') + '）: ' + key);
  return {
    ...result,
    url: '',
    parse: 1,
    playUrl: '',
    ...(provider ? { needDriveCookieBind: provider } : {}),
    message: provider
      ? '该线路需要在「网盘绑定」绑定' + driveProviderLabel(provider) + '网盘' +
        '后才能取流播放（' + failures.join('；') + '）'
      : '该线路需要网盘解链但未成功（' + failures.join('；') +
        '）—— 多为分享失效或源侧改版，建议换线路或换源',
  };
}

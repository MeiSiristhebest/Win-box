import type { JarArchiveDownloadPorts } from './JarSpiderPorts';
import {
  describeFailures,
  fetchWithDisguise,
  siteRootOf,
  UA_OKHTTP,
  type DisguiseAttempt,
} from '../util/fetchWithDisguise';

/** Downloads and validates a spider archive before conversion code touches the filesystem. */
export class JarArchiveDownloader {
  constructor(private readonly ports?: JarArchiveDownloadPorts) {}

  async download(url: string, isJarOrDex: (bytes: Buffer) => boolean): Promise<{ bytes: Buffer; usedLabel?: string }> {
    if (!this.ports) throw new Error('JAR 下载端口未配置');

    const attempts: DisguiseAttempt[] = [
      { label: '默认 UA' },
      { label: 'okhttp UA', ua: UA_OKHTTP },
      { label: 'okhttp UA + Referer', ua: UA_OKHTTP, referer: siteRootOf(url) },
    ];
    const got = await fetchWithDisguise(this.ports.http, url, {
      accept: isJarOrDex,
      attempts,
      retryWithCookie: true,
      timeoutMs: 60000,
      totalTimeoutMs: 120000,
      buffer: 2,
      onTry: (attempt) => {
        const feature = [
          attempt.status ? `HTTP ${attempt.status}` : '',
          attempt.sniff ? `${attempt.sniff.kind} ${attempt.sniff.size}B` : '',
          attempt.reason || '',
        ].filter(Boolean).join(' · ');
        this.ports?.logAttempt(`jvm-bridge jar 下载尝试「${attempt.label}」${attempt.ok ? '命中' : '未命中'}：${feature} ← ${url}`);
      },
    });

    if (!got.buf || got.buf.length < 100) {
      throw new Error(`jar 下载失败：未取得有效 jar/dex（已尝试：${describeFailures(got.tries)}）`);
    }

    return {
      bytes: got.buf,
      ...(got.used?.label ? { usedLabel: got.used.label } : {}),
    };
  }
}

import type { HttpClient, Logger } from '../../shared/types';
import type { SpiderCallResult } from './spiderCallResult';

export interface JarConversionProgress {
  elapsedMs: number;
  attached: boolean;
  stage: 'download' | 'convert';
}

/** Capabilities consumed by a JVM-backed spider; independent of its bridge implementation. */
export interface JarSpiderRuntimePort {
  readonly defaultJar: string;
  ensureConverted(url: string): Promise<string>;
  conversionProgress(url: string): JarConversionProgress | null;
  resolvePaths(urls: string[]): string[];
  peekConverted(url: string): string;
  prewarmJar(paths: string[], className: string, count?: number, ext?: string): number;
  pendingConvert(url: string): Promise<string> | null;
  conversionFailure(url: string): string;
  warmup(url: string): Promise<void>;
  call(
    jarPaths: string[],
    className: string,
    method: string,
    args: string[],
    timeoutMs?: number,
    tag?: string,
    signal?: AbortSignal,
  ): Promise<SpiderCallResult>;
  proxyPortForTag(tag: string): number | null;
}

/** Capabilities the JVM spider bridge actually needs from its composition root. */
export interface JarSpiderBridgeHost {
  http: Pick<HttpClient, 'request'>;
  logger: Pick<Logger, 'i' | 'w' | 'e'>;
}

/** A focused download boundary; callers provide transport and attempt diagnostics. */
export interface JarArchiveDownloadPorts {
  http: Pick<HttpClient, 'request'>;
  logAttempt(message: string): void;
}

/** Logging boundary for the best-effort archive resource merge adapter. */
export type JarResourceMergeLogger = Pick<Logger, 'i' | 'w'>;

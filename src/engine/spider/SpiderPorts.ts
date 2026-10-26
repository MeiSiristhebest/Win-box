import type { HttpClient, Logger } from '../../shared/types';
import type { JsSandboxHostPort, JsSpiderRuntimePort } from '../js/JsSandboxPort';

/** Capabilities consumed by the shared Spider base and native runtime adapters. */
export interface SpiderRuntimeHostPort {
  http: HttpClient;
  logger: Logger;
  driveTokens?: () => Record<string, string>;
}

/** Additional capabilities needed only while constructing and running a JS spider. */
export interface JsSpiderHostPort extends SpiderRuntimeHostPort, JsSandboxHostPort {
  jsSandboxFactory?: ((init: {
    siteKey: string;
    api: string;
    ext: string;
    host: JsSandboxHostPort;
    jsLibDir: string;
  }) => JsSpiderRuntimePort) & { dispose?: () => void };
}

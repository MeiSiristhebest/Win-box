import { request as undiciRequest } from 'undici';
import type { Logger } from '../../shared/types';

export interface SelfResolveRangeOptions {
  method: 'GET';
  headers: Record<string, string>;
  headersTimeout: number;
  bodyTimeout: number;
}

export interface SelfResolveRangeResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: {
    on(event: 'error', listener: (error: Error) => void): unknown;
    destroy(): void;
  };
}

export type SelfResolveRangeRequest = (
  url: string,
  options: SelfResolveRangeOptions,
) => Promise<SelfResolveRangeResponse>;

export interface SelfResolveMediaProbePorts {
  logger: Pick<Logger, 'w'>;
  request?: SelfResolveRangeRequest;
}

/** Infrastructure adapter that validates a candidate media URL with a one-byte request. */
export class SelfResolveMediaProbe {
  private readonly request: SelfResolveRangeRequest;

  constructor(private readonly ports: SelfResolveMediaProbePorts) {
    this.request = ports.request || ((url, options) => undiciRequest(url, options));
  }

  async probe(url: string): Promise<boolean> {
    try {
      const response = await this.request(url, {
        method: 'GET',
        headers: { range: 'bytes=0-0', accept: '*/*' },
        headersTimeout: 20_000,
        bodyTimeout: 20_000,
      });
      const contentType = String(response.headers['content-type'] || '');
      response.body.on('error', () => undefined);
      response.body.destroy();
      if (
        response.statusCode >= 200 &&
        response.statusCode <= 299 &&
        /video|audio|octet-stream|mpegurl|mp2t|dash/i.test(contentType)
      ) {
        return true;
      }
      this.ports.logger.w(`play: 自解链预检失败 status=${response.statusCode} ct=${contentType}: ${url.slice(0, 90)}`);
      return false;
    } catch (error) {
      this.ports.logger.w(`play: 自解链预检异常: ${(error as Error).message}`);
      return false;
    }
  }
}

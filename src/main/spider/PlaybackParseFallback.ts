import type { Logger, PlayResult, ParseBean } from '../../shared/types';
import { wrapPlayUrlWithHeaders } from '../../shared/driveProvider';
import { isHlsPlaylistUrl } from '../../shared/playbackResult';

export interface PlaybackParseHit {
  url: string;
  headers: Record<string, string>;
  via: string;
}

/** Consumer-owned port for resolving a parse-required play result. */
export interface PlaybackParsePort {
  resolve(parses: ParseBean[], target: string, offset?: number): Promise<PlaybackParseHit | null>;
}

export interface PlaybackParseFallbackPorts {
  parser: PlaybackParsePort;
  logger: Pick<Logger, 'i' | 'w'>;
}

/**
 * Converts a parse-required spider result into a playable URL when a configured
 * parser can resolve it. Parser I/O and logging stay behind explicit ports.
 */
export class PlaybackParseFallback {
  constructor(private readonly ports: PlaybackParseFallbackPorts) {}

  async resolve(result: PlayResult, parses: ParseBean[] = [], offset = 0): Promise<PlayResult> {
    if (result.parse !== 1 || !result.url) return result;

    const target = result.url.split('#').filter(Boolean)[0] || result.url;
    try {
      const hit = await this.ports.parser.resolve(parses, target, offset);
      if (hit?.url) {
        this.ports.logger.i(`parse: 「${result.flag}」解析成功（${hit.via}）${hit.url.slice(0, 100)}`);
        return {
          ...result,
          parse: 0,
          parseName: hit.via.replace(/^(json|sniff):/, ''),
          url: Object.keys(hit.headers).length || isHlsPlaylistUrl(hit.url)
            ? wrapPlayUrlWithHeaders(hit.url, hit.headers)
            : hit.url,
          message: undefined,
        };
      }
    } catch (error) {
      this.ports.logger.w(`parse: 解析异常 ${(error as Error).message}`);
    }

    return {
      ...result,
      message: '该播放地址需要网页解析/嗅探，自动解析未取得直连地址（可在配置里补充解析接口或改选其它源）',
    };
  }
}

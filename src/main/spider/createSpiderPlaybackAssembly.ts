import type { PlaybackParsePort } from './PlaybackParseFallback';
import { PlaybackParseFallback } from './PlaybackParseFallback';
import type { SelfResolveMediaProbe } from '../net/SelfResolveMediaProbe';
import { SelfResolveMediaProbe as HttpSelfResolveMediaProbe } from '../net/SelfResolveMediaProbe';
import type { SpiderPlaybackPorts } from './SpiderPlaybackService';
import { SpiderPlaybackService } from './SpiderPlaybackService';
import { extractBaiduShare } from '../net/baiduTransfer';
import { extractQuarkShare } from '../net/quarkTransfer';

export interface SpiderPlaybackAssemblyOptions extends Omit<
  SpiderPlaybackPorts,
  'selfResolveMediaProbe' | 'playbackParseFallback' | 'baiduShareCode' | 'hasQuarkShare'
> {
  parser: PlaybackParsePort;
  probeSelfResolveUrl(url: string): Promise<boolean>;
}

export interface SpiderPlaybackAssembly {
  mediaProbe: SelfResolveMediaProbe;
  playback: SpiderPlaybackService;
}

/** Composes the playback use case from source, drive, parse, and runtime ports. */
export function createSpiderPlaybackAssembly(
  options: SpiderPlaybackAssemblyOptions,
): SpiderPlaybackAssembly {
  const mediaProbe = new HttpSelfResolveMediaProbe({ logger: options.logger });
  const playbackParseFallback = new PlaybackParseFallback({
    parser: options.parser,
    logger: options.logger,
  });
  const { parser: _parser, probeSelfResolveUrl, ...playbackPorts } = options;
  const playback = new SpiderPlaybackService({
    ...playbackPorts,
    baiduShareCode: (url) => extractBaiduShare(url)?.short || '-',
    hasQuarkShare: (url) => !!extractQuarkShare(url),
    selfResolveMediaProbe: { probe: probeSelfResolveUrl },
    playbackParseFallback,
  });

  return { mediaProbe, playback };
}

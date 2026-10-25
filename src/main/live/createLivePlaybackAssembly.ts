import { join } from 'node:path';
import type { HttpClient, Logger, LiveBean, SiteConfig } from '../../shared/types';
import type { LiveTemplate } from '../plugin/pluginLiveTemplate';
import { EpgStore } from './EpgStore';
import { LivePlaybackService } from './LivePlaybackService';

export interface LivePlaybackAssemblyOptions {
  cacheDirectory: string;
  http: HttpClient;
  logger: Logger;
  config(): SiteConfig | null;
  loadSpiderContent(live: LiveBean, config: SiteConfig): Promise<string | number[]>;
  fetchLiveText(url: string): Promise<string | number[]>;
  pluginTemplates(): Promise<LiveTemplate[]>;
}

/** Composes live-source I/O, text decoding, EPG cache, and the live playback use case. */
export function createLivePlaybackAssembly(options: LivePlaybackAssemblyOptions): {
  service: LivePlaybackService;
} {
  let epgStore: EpgStore | null = null;
  const loadEpgText = (url: string): Promise<string> => {
    if (!epgStore) {
      epgStore = new EpgStore({
        http: options.http,
        logger: options.logger,
        dir: join(options.cacheDirectory, 'epg'),
      });
    }
    return epgStore.load(url);
  };
  const toText = (payload: string | number[]): string =>
    typeof payload === 'string' ? payload : Buffer.from(payload).toString('utf-8');

  const service = new LivePlaybackService({
    config: options.config,
    loadSpiderContent: async (live, config) => toText(await options.loadSpiderContent(live, config)),
    fetchLiveText: async (url) => toText(await options.fetchLiveText(url)),
    loadEpgText,
    pluginTemplates: options.pluginTemplates,
    logger: options.logger,
  });
  return { service };
}

import { join } from 'node:path';
import type { Logger } from '../../shared/types';
import type { DanmakuSource } from '../plugin/pluginDanmakuSource';
import { DanmakuService } from './DanmakuService';
import { DanmakuStore } from './DanmakuStore';
import {
  DanmakuEndpointHealth,
  logvarBangumi,
  logvarComment,
  logvarSearchAnime,
  mapLimit,
} from './logvarProvider';
import { endpointLabel, rankDanmakuAnimes } from '../../engine/danmaku/endpoints';

export interface DanmakuServiceAssemblyOptions {
  userDataDirectory: string;
  logger: Logger;
  listPluginSources: () => Promise<DanmakuSource[]>;
}

export function createDanmakuServiceAssembly(options: DanmakuServiceAssemblyOptions): {
  store: DanmakuStore;
  service: DanmakuService;
} {
  const store = new DanmakuStore(join(options.userDataDirectory, 'danmaku.json'), options.logger);
  const service = new DanmakuService({
    settings: store,
    plugins: { list: options.listPluginSources },
    api: {
      searchAnime: logvarSearchAnime,
      episodes: logvarBangumi,
      comment: logvarComment,
    },
    health: new DanmakuEndpointHealth(),
    mapConcurrent: (items, limit, worker) => mapLimit([...items], limit, worker),
    rank: rankDanmakuAnimes,
    endpointLabel,
    now: () => Date.now(),
    logger: options.logger,
  });

  return { store, service };
}

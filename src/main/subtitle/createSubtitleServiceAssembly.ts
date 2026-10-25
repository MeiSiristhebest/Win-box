import { join } from 'node:path';
import type { Logger } from '../../shared/types';
import type { SubtitleProvider } from './provider';
import { SubtitleService } from './SubtitleService';
import { SubtitleStore } from './SubtitleStore';
import type { DriveCodec } from '../store/DriveStore';

export interface SubtitleServiceAssemblyOptions {
  userDataDirectory: string;
  logger: Logger;
  credentialCodec: DriveCodec;
  listPluginProviders: () => Promise<SubtitleProvider[]>;
}

export function createSubtitleServiceAssembly(options: SubtitleServiceAssemblyOptions): {
  store: SubtitleStore;
  service: SubtitleService;
} {
  const store = new SubtitleStore(
    join(options.userDataDirectory, 'subtitle.json'),
    options.logger,
    options.credentialCodec,
  );
  const service = new SubtitleService({
    settings: {
      get: () => store.settings,
      set: (settings) => { store.settings = settings; },
      update: (patch) => store.update(patch),
    },
    plugins: { list: options.listPluginProviders },
    logger: options.logger,
  });

  return { store, service };
}

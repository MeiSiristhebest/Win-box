import { client } from '../../../api/client';
import type { SubtitleSettingsPort } from '../application/subtitleSettingsPort';

export const rendererSubtitleSettingsAdapter: SubtitleSettingsPort = {
  getSettings: () => client.subtitleGet(),
  saveSettings: (patch) => client.subtitleSet(patch),
  listProviders: () => client.subtitleProviders(),
};

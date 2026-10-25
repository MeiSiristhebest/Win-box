import { client } from '../../../api/client';
import type { ShortcutSettingsPort } from '../application/settingsSectionPorts';

export const shortcutSettingsAdapter: ShortcutSettingsPort = {
  loadBossKey: () => client.bossGet(),
  saveBossKey: (patch) => client.bossSet(patch),
};

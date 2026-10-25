import { client } from '../../../api/client';
import type { PlayerEngineSettingsPort } from '../application/settingsSectionPorts';

export const playerEngineSettingsAdapter: PlayerEngineSettingsPort = {
  listEngines: () => client.engineList(),
  loadPlayerSettings: () => client.playerPrefsGet(),
  setEngineEnabled: (input) => client.engineSetEnabled(input),
  savePlayerSettings: (patch) => client.playerPrefsSet(patch),
};

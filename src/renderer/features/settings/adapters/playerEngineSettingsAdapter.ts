import { client } from '../../../api/client';
import type { PlayerEngineActivationPort, PlayerEngineCatalogPort, PlayerEnginePathSettingsPort } from '../application/playerEngineSettingsPorts';

export const playerEngineSettingsAdapter: PlayerEngineCatalogPort & PlayerEngineActivationPort & PlayerEnginePathSettingsPort = {
  listEngines: () => client.engineList(),
  loadPlayerSettings: () => client.playerPrefsGet(),
  setEngineEnabled: (input) => client.engineSetEnabled(input),
  savePlayerSettings: (patch) => client.playerPrefsSet(patch),
};

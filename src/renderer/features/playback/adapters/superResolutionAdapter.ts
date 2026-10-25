import type { SrMode } from '../../../../shared/player';
import { client } from '../../../api/client';
import type { SuperResolutionPort } from '../application/superResolutionPort';

export const superResolutionAdapter: SuperResolutionPort = {
  readCapability: () => client.pluginSr(),
  saveMode: async (mode: SrMode) => { await client.playerPrefsSet({ srMode: mode }); },
  applyMode: (mode: SrMode) => client.mpvCmd({ type: 'sr-mode', value: mode }),
};

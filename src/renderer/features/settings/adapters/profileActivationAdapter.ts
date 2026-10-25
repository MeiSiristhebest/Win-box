import { client } from '../../../api/client';
import { notifyProfileChanged } from '../../../lib/configEvents';
import type { ProfileActivationPort } from '../application/configurationPagePorts';

export const profileActivationAdapter: ProfileActivationPort = {
  activate: (profileId) => client.cfgActivateProfile(profileId),
  announceProfileChanged: notifyProfileChanged,
};

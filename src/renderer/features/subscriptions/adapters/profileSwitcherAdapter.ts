import { client } from '../../../api/client';
import { notifyProfileChanged, SOURCES_CHANGED_EVENT } from '../../../lib/configEvents';
import type { ProfileSwitcherPort } from '../application/profileSwitcherPort';

export const profileSwitcherAdapter: ProfileSwitcherPort = {
  loadConfiguration: () => client.cfgGet(),
  activateProfile: profileId => client.cfgActivateProfile(profileId),
  publishProfileChanged: notifyProfileChanged,
  subscribeToProfileRefresh(listener) {
    window.addEventListener(SOURCES_CHANGED_EVENT, listener);
    window.addEventListener('focus', listener);
    return () => {
      window.removeEventListener(SOURCES_CHANGED_EVENT, listener);
      window.removeEventListener('focus', listener);
    };
  },
};

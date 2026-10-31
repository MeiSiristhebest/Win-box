import { client } from '../../../api/client';
import { notifyProfileChanged, PROFILE_CHANGED_EVENT, SOURCE_CHANGED_EVENT, SOURCES_CHANGED_EVENT } from '../../../lib/configEvents';
import type { SourcePickerPort } from '../application/sourcePickerPort';

export const sourcePickerAdapter: SourcePickerPort = {
  async loadCurrentSources() {
    const config = await client.cfgGet();
    return { sources: config.sources || [], activeSourceKey: config.ui?.activeSourceKey || '' };
  },
  loadProfileSites: () => client.cfgProfileSites(),
  setActiveSource: sourceKey => client.cfgSetActiveSource(sourceKey),
  activateProfile: profileId => client.cfgActivateProfile(profileId),
  switchProfileSource: (profileId, sourceKey) => client.cfgSwitchProfileSource(profileId, sourceKey),
  publishSourceChanged(sourceKey) {
    window.dispatchEvent(new CustomEvent(SOURCE_CHANGED_EVENT, { detail: sourceKey }));
  },
  publishProfileChanged: notifyProfileChanged,
  subscribeToCurrentSourcesRefresh(listener) {
    window.addEventListener('focus', listener);
    window.addEventListener(SOURCE_CHANGED_EVENT, listener);
    window.addEventListener(SOURCES_CHANGED_EVENT, listener);
    return () => {
      window.removeEventListener('focus', listener);
      window.removeEventListener(SOURCE_CHANGED_EVENT, listener);
      window.removeEventListener(SOURCES_CHANGED_EVENT, listener);
    };
  },
  subscribeToProfileSitesRefresh(listener) {
    window.addEventListener(SOURCES_CHANGED_EVENT, listener);
    window.addEventListener(PROFILE_CHANGED_EVENT, listener);
    return () => {
      window.removeEventListener(SOURCES_CHANGED_EVENT, listener);
      window.removeEventListener(PROFILE_CHANGED_EVENT, listener);
    };
  },
};

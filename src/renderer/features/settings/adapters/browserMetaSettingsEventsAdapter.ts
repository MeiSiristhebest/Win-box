import type { MetaSettingsEventsPort } from '../application/metaSettingsEventsPort';

export const browserMetaSettingsEventsAdapter: MetaSettingsEventsPort = {
  notifyChanged() {
    try {
      localStorage.setItem('winbox-meta-revision', String(Date.now()));
    } catch {
      // The same-window event still refreshes metadata when storage is disabled.
    }
    window.dispatchEvent(new Event('winbox:meta-changed'));
  },
};

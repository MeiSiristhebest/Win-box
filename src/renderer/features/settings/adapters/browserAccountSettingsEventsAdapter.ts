import type { AccountSettingsEventsPort } from '../application/accountSettingsEventsPort';

export const browserAccountSettingsEventsAdapter: AccountSettingsEventsPort = {
  notifyMetaSettingsChanged() {
    try {
      localStorage.setItem('winbox-meta-revision', String(Date.now()));
    } catch {
      // The same-window event still refreshes metadata when storage is disabled.
    }
    window.dispatchEvent(new Event('winbox:meta-changed'));
  },
  notifyDriveAccountsChanged() {
    window.dispatchEvent(new Event('winbox:drives-changed'));
  },
};

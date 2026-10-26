import type { DriveAccountsEventsPort } from '../application/driveAccountsEventsPort';

export const browserDriveAccountsEventsAdapter: DriveAccountsEventsPort = {
  notifyChanged() {
    window.dispatchEvent(new Event('winbox:drives-changed'));
  },
};

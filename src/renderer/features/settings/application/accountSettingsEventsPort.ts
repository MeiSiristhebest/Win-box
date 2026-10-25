export interface AccountSettingsEventsPort {
  notifyMetaSettingsChanged(): void;
  notifyDriveAccountsChanged(): void;
}

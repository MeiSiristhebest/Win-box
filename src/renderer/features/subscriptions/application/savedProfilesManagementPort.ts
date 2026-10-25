export interface SavedProfilesManagementPort {
  saveCurrentProfile(name: string): Promise<void>;
  renameProfile(input: { id: string; name: string }): Promise<void>;
  deleteProfile(id: string): Promise<void>;
}

export interface LiveSourcesManagementPort {
  selectLiveSource(index: number): Promise<void>;
  deleteLiveSource(index: number): Promise<void>;
  renameLiveSource(input: { index: number; name: string }): Promise<void>;
}

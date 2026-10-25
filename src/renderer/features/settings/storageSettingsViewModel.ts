import type { DavServer } from '../../../shared/webdav';

export interface StorageSettingsViewModel {
  loadState: 'loading' | 'ready' | 'error';
  listError: string | null;
  servers: DavServer[];
  draft: DavServer;
  message: { text: string; kind: 'ok' | 'err' | 'warn' } | null;
  busy: boolean;
  refreshing: boolean;
}

export interface StorageSettingsViewActions {
  updateDraft(patch: Partial<DavServer>): void;
  edit(server: DavServer): void;
  clearDraft(): void;
  save(): Promise<void>;
  remove(server: DavServer): Promise<void>;
  test(): Promise<void>;
  refresh(): Promise<void>;
}

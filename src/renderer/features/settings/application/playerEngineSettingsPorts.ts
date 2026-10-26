import type { PlayerEngineView } from '../../../../shared/plugin';
import type { PlayerSettings } from '../../../../shared/player';

export interface PlayerEngineCatalogPort {
  listEngines(): Promise<PlayerEngineView[]>;
}

export interface PlayerEngineActivationPort {
  setEngineEnabled(input: { id: string; enabled: boolean }): Promise<{ ok: boolean; reason?: string }>;
}

export interface PlayerEnginePathSettingsPort {
  loadPlayerSettings(): Promise<PlayerSettings>;
  savePlayerSettings(patch: Partial<PlayerSettings>): Promise<PlayerSettings>;
}

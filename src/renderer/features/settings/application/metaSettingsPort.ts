import type { MetaSettings, MetaSettingsView } from '../../../../shared/meta';

export interface MetaSettingsPort {
  getSettings(): Promise<MetaSettingsView>;
  saveSettings(patch: Partial<MetaSettings>): Promise<MetaSettingsView>;
}

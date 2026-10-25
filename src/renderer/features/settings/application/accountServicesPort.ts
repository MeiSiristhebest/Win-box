import type { MetaSettings, MetaSettingsView } from '../../../../shared/meta';
import type { SubtitleProviderView, SubtitleSettings } from '../../../../shared/subtitle';

export interface AccountServicesPort {
  getSubtitleSettings(): Promise<SubtitleSettings>;
  setSubtitleSettings(patch: Partial<SubtitleSettings>): Promise<SubtitleSettings>;
  getSubtitleProviders(): Promise<SubtitleProviderView[]>;
  getMetaSettings(): Promise<MetaSettingsView>;
  setMetaSettings(patch: Partial<MetaSettings>): Promise<MetaSettingsView>;
}

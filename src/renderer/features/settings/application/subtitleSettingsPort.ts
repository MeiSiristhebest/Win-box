import type { SubtitleProviderView, SubtitleSettings } from '../../../../shared/subtitle';

export interface SubtitleSettingsPort {
  getSettings(): Promise<SubtitleSettings>;
  saveSettings(patch: Partial<SubtitleSettings>): Promise<SubtitleSettings>;
  listProviders(): Promise<SubtitleProviderView[]>;
}

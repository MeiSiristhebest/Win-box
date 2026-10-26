import type { PosterSize } from '../../../../shared/posterSize';
import type { UiScalePref, UiScaleState } from '../../../../shared/uiScale';
import type { MotionPreference } from '../../../../shared/uiPreferences';
import type { Theme } from '../../../../shared/ui/themeTokens';

export type AppearanceNavMode = 'inline' | 'window';

export interface AppearanceSectionViewModel {
  theme: Theme;
  skins: readonly { id: string; label: string }[];
  motion: MotionPreference;
  showDiscover: boolean;
  navMode: AppearanceNavMode;
  waterfall: boolean;
  uiScale: UiScaleState;
  posterSize: PosterSize;
  scaleError: string;
}

export interface AppearanceSectionViewActions {
  changeTheme(theme: Theme): void;
  changeMotion(motion: MotionPreference): void;
  changeDiscoverVisibility(visible: boolean): void;
  changeUiScale(scale: UiScalePref): void;
  changePosterSize(size: PosterSize): void;
  changeNavMode(mode: AppearanceNavMode): void;
  changeWaterfall(enabled: boolean): void;
}

import { useState } from 'react';
import type { PosterSize } from '../../../shared/posterSize';
import type { UiScalePref } from '../../../shared/uiScale';
import type { MotionPreference } from '../../../shared/uiPreferences';
import type { Theme } from '../../../shared/ui/themeTokens';
import type {
  AppearanceNavMode,
  AppearanceSectionViewActions,
  AppearanceSectionViewModel,
} from './presentation/appearanceSectionViewModel';

type AppearanceSectionSnapshot = Omit<AppearanceSectionViewModel, 'scaleError'>;

interface AppearanceSectionCommands {
  changeTheme(theme: Theme): void;
  changeMotion(motion: MotionPreference): void;
  changeDiscoverVisibility(visible: boolean): void;
  changeUiScale(scale: UiScalePref): Promise<void>;
  changePosterSize(size: PosterSize): void;
  changeNavMode(mode: AppearanceNavMode): void;
  changeWaterfall(enabled: boolean): void;
}

interface AppearanceSectionPresenterInput {
  snapshot: AppearanceSectionSnapshot;
  commands: AppearanceSectionCommands;
}

export function useAppearanceSectionPresenter({ snapshot, commands }: AppearanceSectionPresenterInput) {
  const [scaleError, setScaleError] = useState('');
  const actions: AppearanceSectionViewActions = {
    changeTheme: commands.changeTheme,
    changeMotion: commands.changeMotion,
    changeDiscoverVisibility: commands.changeDiscoverVisibility,
    changeUiScale(scale) {
      setScaleError('');
      void commands.changeUiScale(scale).catch(() => setScaleError('缩放未保存，请重试。'));
    },
    changePosterSize: commands.changePosterSize,
    changeNavMode: commands.changeNavMode,
    changeWaterfall: commands.changeWaterfall,
  };

  return { model: { ...snapshot, scaleError }, actions };
}

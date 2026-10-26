import { setUiScale, usePosterSizePreference, useUiScaleState } from '../display';
import { useTheme, useSkins } from '../theme/adapters/useThemeStore';
import { themeApplication } from '../theme/themeRuntime';
import { appearancePreferenceCommands, useAppearancePreferences } from './adapters/appearancePreferencesAdapter';
import { AppearanceSectionView } from './AppearanceSectionView';
import { useAppearanceSectionPresenter } from './useAppearanceSectionPresenter';

export function AppearanceSection() {
  const theme = useTheme();
  const skins = useSkins();
  const preferences = useAppearancePreferences();
  const posterSize = usePosterSizePreference();
  const uiScale = useUiScaleState();
  const presentation = useAppearanceSectionPresenter({
    snapshot: { theme, skins, ...preferences, posterSize: posterSize.size, uiScale },
    commands: {
      changeTheme: themeApplication.applyTheme,
      ...appearancePreferenceCommands,
      changePosterSize: posterSize.changeSize,
      changeUiScale: setUiScale,
    },
  });

  return <AppearanceSectionView {...presentation} />;
}

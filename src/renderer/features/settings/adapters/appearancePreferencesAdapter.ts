import {
  setMotionPref,
  setNavMode,
  setShowDiscover,
  setWaterfall,
  useMotionPref,
  useNavMode,
  useShowDiscover,
  useWaterfall,
} from '../../../lib/uiPrefs';

export function useAppearancePreferences() {
  return {
    motion: useMotionPref(),
    showDiscover: useShowDiscover(),
    navMode: useNavMode(),
    waterfall: useWaterfall(),
  };
}

export const appearancePreferenceCommands = {
  changeMotion: setMotionPref,
  changeDiscoverVisibility: setShowDiscover,
  changeNavMode: setNavMode,
  changeWaterfall: setWaterfall,
};

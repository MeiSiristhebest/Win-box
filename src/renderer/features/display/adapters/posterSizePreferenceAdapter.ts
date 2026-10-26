import { setPosterSize, usePosterSize } from '../../../lib/uiPrefs';

export function usePosterSizePreference() {
  return { size: usePosterSize(), changeSize: setPosterSize };
}

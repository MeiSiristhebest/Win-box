import { useWaterfall } from '../../../lib/uiPrefs';

/** Reads the persisted waterfall-display preference at the HomePage composition root. */
export function useHomeWaterfallPreference(): boolean {
  return useWaterfall();
}

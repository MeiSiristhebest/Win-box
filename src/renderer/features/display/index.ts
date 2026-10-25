import { displayPreferencesSession } from './adapters/displayPreferencesAdapter';
import { useUiScaleState as useSessionUiScaleState } from './presentation/useUiScaleState';
import type { UiScalePref } from '../../../shared/uiScale';

export function initDisplayPrefs(): Promise<void> {
  return displayPreferencesSession.initialize();
}

export function setUiScale(value: UiScalePref): Promise<void> {
  return displayPreferencesSession.setScale(value);
}

export function useUiScaleState() {
  return useSessionUiScaleState(displayPreferencesSession);
}

import { useSyncExternalStore } from 'react';
import type { DisplayPreferencesSession } from '../application/displayPreferences';

export function useUiScaleState(session: DisplayPreferencesSession) {
  return useSyncExternalStore(session.subscribe, session.getSnapshot, session.getServerSnapshot);
}

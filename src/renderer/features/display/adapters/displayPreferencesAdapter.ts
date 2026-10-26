import { client } from '../../../api/client';
import { getPosterSize } from '../../../lib/uiPrefs';
import { subscribePreference } from '../../../adapters/uiPreferencesAdapter';
import { UI_PREFERENCE_KEYS } from '../../../lib/uiPreferenceMapping';
import { createDisplayPreferencesSession } from '../application/displayPreferences';

export const displayPreferencesSession = createDisplayPreferencesSession({
  scale: {
    read: () => client.uiGetScale(),
    set: (value) => client.uiSetScale(value),
    subscribe: (listener) => client.onUiScaleChanged(listener),
  },
  posterSizing: {
    readSize: getPosterSize,
    subscribe: (listener) => subscribePreference(UI_PREFERENCE_KEYS.posterSize, listener),
    apply(sizing) {
      const root = document.documentElement;
      root.style.setProperty('--poster-width', `${sizing.width}px`);
      root.style.setProperty('--poster-intrinsic-height', `${sizing.intrinsicHeight}px`);
      root.style.setProperty('--poster-gap', `${sizing.gap}px`);
      root.style.setProperty('--ui-zoom', sizing.zoom);
      root.dataset.posterSize = sizing.size;
    },
  },
});

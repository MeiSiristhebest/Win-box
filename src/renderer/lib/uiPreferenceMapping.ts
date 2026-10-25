import { DEFAULT_UI_PREFERENCES, validateUiPreferencesPatch, type UiPreferencesPatch, type UiPreferencesSnapshot } from '../../shared/uiPreferences';
import { normalizePosterSize } from '../../shared/posterSize';
import { normalizeTheme } from './themeTokens';

/** Stable browser-cache keys for the single main-process UI-preferences aggregate. */
export const UI_PREFERENCE_KEYS = {
  theme: 'winbox-theme',
  discover: 'winbox-show-discover',
  waterfall: 'winbox-waterfall',
  motion: 'winbox-motion',
  homeFilters: 'winbox-home-filters',
  navMode: 'winbox-nav-mode',
  posterSize: 'winbox-poster-size',
} as const;

export const UI_PREFERENCE_KEY_LIST = Object.values(UI_PREFERENCE_KEYS);

const REQUIRED_SNAPSHOT_FIELDS = ['themeId', 'motion', 'showDiscover', 'waterfall'] as const;

/** Converts an untrusted IPC snapshot into the complete renderer model. */
export function normalizeUiPreferencesSnapshot(value: unknown): UiPreferencesSnapshot | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<UiPreferencesSnapshot>;
  if (typeof candidate.revision !== 'number'
    || !Number.isSafeInteger(candidate.revision)
    || candidate.revision < 0
    || typeof candidate.initialized !== 'boolean') return null;

  let patch: UiPreferencesPatch;
  try {
    patch = validateUiPreferencesPatch(candidate.values);
  } catch {
    return null;
  }
  if (REQUIRED_SNAPSHOT_FIELDS.some((field) => !Object.hasOwn(patch, field))) return null;

  return {
    revision: candidate.revision,
    initialized: candidate.initialized,
    values: { ...DEFAULT_UI_PREFERENCES, ...patch },
  };
}

/** Projects a main-process snapshot to the legacy string-key preference API. */
export function preferenceValueFromSnapshot(snapshot: UiPreferencesSnapshot | null, key: string): string | null {
  if (!snapshot?.initialized) return null;
  switch (key) {
    case UI_PREFERENCE_KEYS.theme: return snapshot.values.themeId;
    case UI_PREFERENCE_KEYS.motion: return snapshot.values.motion;
    case UI_PREFERENCE_KEYS.discover: return snapshot.values.showDiscover ? '1' : '0';
    case UI_PREFERENCE_KEYS.waterfall: return snapshot.values.waterfall ? '1' : '0';
    case UI_PREFERENCE_KEYS.homeFilters: return snapshot.values.homeFilters ? '1' : '0';
    case UI_PREFERENCE_KEYS.posterSize: return snapshot.values.posterSize || 'medium';
    case UI_PREFERENCE_KEYS.navMode: return snapshot.values.navMode === 'window' ? 'window' : 'inline';
    default: return null;
  }
}

/** Converts legacy browser strings into the main-process aggregate's migration patch. */
export function legacyUiPreferencesPatch(values: Readonly<Record<string, string | null>>): UiPreferencesPatch {
  const theme = values[UI_PREFERENCE_KEYS.theme];
  const motion = values[UI_PREFERENCE_KEYS.motion];
  return {
    themeId: (theme && /^plugin:[a-z0-9-]{3,40}$/.test(theme) ? theme : normalizeTheme(theme)) as UiPreferencesPatch['themeId'],
    motion: motion === 'on' || motion === 'off' ? motion : DEFAULT_UI_PREFERENCES.motion,
    showDiscover: values[UI_PREFERENCE_KEYS.discover] !== '0',
    waterfall: values[UI_PREFERENCE_KEYS.waterfall] === '1',
    homeFilters: values[UI_PREFERENCE_KEYS.homeFilters] === '1',
    navMode: values[UI_PREFERENCE_KEYS.navMode] === 'window' ? 'window' : 'inline',
    posterSize: normalizePosterSize(values[UI_PREFERENCE_KEYS.posterSize]),
  };
}

/** Serializes the aggregate for the local browser cache and cross-window fallback. */
export function preferenceValuesAsStrings(snapshot: UiPreferencesSnapshot): Record<string, string> {
  return {
    [UI_PREFERENCE_KEYS.theme]: snapshot.values.themeId,
    [UI_PREFERENCE_KEYS.motion]: snapshot.values.motion,
    [UI_PREFERENCE_KEYS.discover]: snapshot.values.showDiscover ? '1' : '0',
    [UI_PREFERENCE_KEYS.waterfall]: snapshot.values.waterfall ? '1' : '0',
    [UI_PREFERENCE_KEYS.homeFilters]: snapshot.values.homeFilters ? '1' : '0',
    [UI_PREFERENCE_KEYS.posterSize]: snapshot.values.posterSize || 'medium',
    [UI_PREFERENCE_KEYS.navMode]: snapshot.values.navMode === 'window' ? 'window' : 'inline',
  };
}

/** Translates a legacy single-key write into a patch of the shared preference aggregate. */
export function preferencePatchForKey(key: string, value: string): UiPreferencesPatch | null {
  if (key === UI_PREFERENCE_KEYS.theme) return { themeId: value as UiPreferencesPatch['themeId'] };
  if (key === UI_PREFERENCE_KEYS.motion) return { motion: value === 'on' || value === 'off' ? value : 'auto' };
  if (key === UI_PREFERENCE_KEYS.discover) return { showDiscover: value !== '0' };
  if (key === UI_PREFERENCE_KEYS.waterfall) return { waterfall: value === '1' };
  if (key === UI_PREFERENCE_KEYS.homeFilters) return { homeFilters: value === '1' };
  if (key === UI_PREFERENCE_KEYS.posterSize) return { posterSize: normalizePosterSize(value) };
  if (key === UI_PREFERENCE_KEYS.navMode) return { navMode: value === 'window' ? 'window' : 'inline' };
  return null;
}

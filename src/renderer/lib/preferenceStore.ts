import { client } from '../api/client';
import type { UiPreferencesPatch, UiPreferencesSnapshot } from '../../shared/uiPreferences';
import { DEFAULT_UI_PREFERENCES, UI_THEME_IDS, validateUiPreferencesPatch } from '../../shared/uiPreferences';

type PreferenceListener = () => void;

const THEME_KEY = 'winbox-theme';
const DISCOVER_KEY = 'winbox-show-discover';
const WATERFALL_KEY = 'winbox-waterfall';
const MOTION_KEY = 'winbox-motion';
const HOME_FILTERS_KEY = 'winbox-home-filters';
const NAV_MODE_KEY = 'winbox-nav-mode';
const PREFERENCE_KEYS = [THEME_KEY, MOTION_KEY, DISCOVER_KEY, WATERFALL_KEY, HOME_FILTERS_KEY, NAV_MODE_KEY] as const;
const PREFERENCE_FIELDS = ['themeId', 'motion', 'showDiscover', 'waterfall'] as const;

const listenersByKey = new Map<string, Set<PreferenceListener>>();
let latestSnapshot: UiPreferencesSnapshot | null = null;
let unsubscribeMain: (() => void) | null = null;
let mainSubscriptionSystem: Window['api']['system'] | null = null;
let listeningToStorage = false;
let bootstrapPending = false;
let keepMainSubscriptionUntilSubscriber = false;
let syncRequest: Promise<void> | null = null;

function isWindowAvailable(): boolean {
  return typeof window !== 'undefined';
}

function readStoredPreference(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function snapshotValue(key: string): string | null {
  if (!latestSnapshot?.initialized) return null;
  switch (key) {
    case THEME_KEY: return latestSnapshot.values.themeId;
    case MOTION_KEY: return latestSnapshot.values.motion;
    case DISCOVER_KEY: return latestSnapshot.values.showDiscover ? '1' : '0';
    case WATERFALL_KEY: return latestSnapshot.values.waterfall ? '1' : '0';
    case HOME_FILTERS_KEY: return latestSnapshot.values.homeFilters ? '1' : '0';
    case NAV_MODE_KEY: return latestSnapshot.values.navMode === 'window' ? 'window' : 'inline';
    default: return null;
  }
}

/** The main-process snapshot wins in Electron; localStorage remains the browser-preview fallback and migration cache. */
export function readPreference(key: string): string | null {
  return snapshotValue(key) ?? readStoredPreference(key);
}

function legacyPreferences(): UiPreferencesPatch {
  const theme = readStoredPreference(THEME_KEY);
  const motion = readStoredPreference(MOTION_KEY);
  return {
    themeId: theme && ((UI_THEME_IDS as readonly string[]).includes(theme) || /^plugin:[a-z0-9-]{3,40}$/.test(theme))
      ? theme as UiPreferencesPatch['themeId']
      : DEFAULT_UI_PREFERENCES.themeId,
    motion: motion === 'on' || motion === 'off' ? motion : DEFAULT_UI_PREFERENCES.motion,
    showDiscover: readStoredPreference(DISCOVER_KEY) !== '0',
    waterfall: readStoredPreference(WATERFALL_KEY) === '1',
    homeFilters: readStoredPreference(HOME_FILTERS_KEY) === '1',
    navMode: readStoredPreference(NAV_MODE_KEY) === 'window' ? 'window' : 'inline',
  };
}

function valuesAsStrings(snapshot: UiPreferencesSnapshot): Record<string, string> {
  return {
    [THEME_KEY]: snapshot.values.themeId,
    [MOTION_KEY]: snapshot.values.motion,
    [DISCOVER_KEY]: snapshot.values.showDiscover ? '1' : '0',
    [WATERFALL_KEY]: snapshot.values.waterfall ? '1' : '0',
    [HOME_FILTERS_KEY]: snapshot.values.homeFilters ? '1' : '0',
    [NAV_MODE_KEY]: snapshot.values.navMode === 'window' ? 'window' : 'inline',
  };
}

function notifyPreference(key: string): void {
  for (const listener of listenersByKey.get(key) ?? []) listener();
}

function applySnapshot(value: UiPreferencesSnapshot): void {
  if (!value || !Number.isSafeInteger(value.revision) || value.revision < 0 || typeof value.initialized !== 'boolean') return;
  const patch = (() => {
    try { return validateUiPreferencesPatch(value.values); } catch { return null; }
  })();
  if (!patch || PREFERENCE_FIELDS.some((field) => !Object.hasOwn(patch, field))) return;
  const validatedValues: UiPreferencesSnapshot['values'] = { ...DEFAULT_UI_PREFERENCES, ...patch };

  const snapshot: UiPreferencesSnapshot = {
    revision: value.revision,
    initialized: value.initialized,
    values: validatedValues,
  };
  if (latestSnapshot && snapshot.revision < latestSnapshot.revision) return;
  if (latestSnapshot && latestSnapshot.initialized && !snapshot.initialized) return;
  const previousValues = new Map<string, string | null>(PREFERENCE_KEYS.map((key) => [key, readPreference(key)] as const));
  if (latestSnapshot && snapshot.revision === latestSnapshot.revision) {
    const previous = latestSnapshot.values;
    const next = snapshot.values;
    if (snapshot.initialized !== latestSnapshot.initialized
      || previous.themeId !== next.themeId
      || previous.motion !== next.motion
      || previous.showDiscover !== next.showDiscover
      || previous.waterfall !== next.waterfall
      || previous.homeFilters !== next.homeFilters
      || previous.navMode !== next.navMode) return;
  } else {
    latestSnapshot = snapshot;
  }

  if (!snapshot.initialized) return;

  const values = valuesAsStrings(snapshot);
  try {
    for (const [key, preference] of Object.entries(values)) localStorage.setItem(key, preference);
  } catch {
    // The in-memory and main-process values remain available when browser storage is disabled.
  }
  for (const key of PREFERENCE_KEYS) {
    if (previousValues.get(key) !== values[key]) notifyPreference(key);
  }
}

function hasMainPreferenceEvents(): boolean {
  return isWindowAvailable() && typeof window.api?.system?.onUiPreferencesChanged === 'function';
}

function hasMainPreferenceUpdates(): boolean {
  return isWindowAvailable() && typeof window.api?.system?.updateUiPreferences === 'function';
}

function onStorage(event: StorageEvent): void {
  if (event.key === null) {
    for (const key of listenersByKey.keys()) notifyPreference(key);
  } else if (listenersByKey.has(event.key)) {
    notifyPreference(event.key);
  }
}

function ensureExternalListener(): void {
  if (!isWindowAvailable()) return;
  const system = window.api?.system;
  if (typeof system?.onUiPreferencesChanged === 'function') {
    if (!unsubscribeMain || mainSubscriptionSystem !== system) {
      unsubscribeMain?.();
      unsubscribeMain = client.onUiPreferencesChanged(applySnapshot);
      mainSubscriptionSystem = system;
    }
    if (listeningToStorage) {
      window.removeEventListener('storage', onStorage);
      listeningToStorage = false;
    }
    return;
  }
  unsubscribeMain?.();
  unsubscribeMain = null;
  mainSubscriptionSystem = null;
  if (!listeningToStorage) {
    window.addEventListener('storage', onStorage);
    listeningToStorage = true;
  }
}

function releaseExternalListenerIfUnused(): void {
  if (bootstrapPending || keepMainSubscriptionUntilSubscriber || listenersByKey.size > 0 || !isWindowAvailable()) return;
  unsubscribeMain?.();
  unsubscribeMain = null;
  mainSubscriptionSystem = null;
  if (listeningToStorage) {
    window.removeEventListener('storage', onStorage);
    listeningToStorage = false;
  }
}

function patchForKey(key: string, value: string): UiPreferencesPatch | null {
  if (key === THEME_KEY) return { themeId: value as UiPreferencesPatch['themeId'] };
  if (key === MOTION_KEY) return { motion: value === 'on' || value === 'off' ? value : 'auto' };
  if (key === DISCOVER_KEY) return { showDiscover: value !== '0' };
  if (key === WATERFALL_KEY) return { waterfall: value === '1' };
  if (key === HOME_FILTERS_KEY) return { homeFilters: value === '1' };
  if (key === NAV_MODE_KEY) return { navMode: value === 'window' ? 'window' : 'inline' };
  return null;
}

/** Imports existing renderer preferences once, then uses the main-process snapshot as the durable source. */
export function syncUiPreferencesFromMain(): Promise<void> {
  if (syncRequest) return syncRequest;
  if (!isWindowAvailable()
    || typeof window.api?.system?.getUiPreferences !== 'function'
    || typeof window.api?.system?.initializeUiPreferences !== 'function') return Promise.resolve();

  bootstrapPending = true;
  ensureExternalListener();
  syncRequest = (async () => {
    const stored = await client.getUiPreferences();
    const current = latestSnapshot && latestSnapshot.revision > stored.revision
      ? latestSnapshot
      : stored;
    const snapshot = current.initialized
      ? current
      : await client.initializeUiPreferences(legacyPreferences());
    applySnapshot(snapshot);
  })().finally(() => {
    bootstrapPending = false;
    keepMainSubscriptionUntilSubscriber = hasMainPreferenceEvents();
    syncRequest = null;
    releaseExternalListenerIfUnused();
  });
  return syncRequest;
}

/** Applies restored backup values to the main-process preference store. */
export async function syncUiPreferencesToMain(): Promise<void> {
  if (!hasMainPreferenceUpdates()) return;
  applySnapshot(await client.updateUiPreferences(legacyPreferences()));
}

export function writePreference(key: string, value: string): void {
  const patch = patchForKey(key, value);
  if (patch && hasMainPreferenceUpdates()) {
    const restoreMainValue = (): void => {
      if (latestSnapshot) applySnapshot(latestSnapshot);
      notifyPreference(key);
    };
    try {
      void client.updateUiPreferences(patch).then(applySnapshot).catch(() => {
        restoreMainValue();
      });
    } catch {
      restoreMainValue();
    }
    return;
  }

  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Ignore storage failures in browser preview.
  }
  if (isWindowAvailable()) notifyPreference(key);
}

export function subscribePreference(key: string, listener: PreferenceListener): () => void {
  if (!isWindowAvailable()) return () => undefined;
  keepMainSubscriptionUntilSubscriber = false;
  const listeners = listenersByKey.get(key) ?? new Set<PreferenceListener>();
  listeners.add(listener);
  listenersByKey.set(key, listeners);
  ensureExternalListener();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) listenersByKey.delete(key);
    releaseExternalListenerIfUnused();
  };
}

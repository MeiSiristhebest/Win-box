import { client } from '../api/client';
import type { UiPreferencesPatch, UiPreferencesSnapshot } from '../../shared/uiPreferences';
import {
  legacyUiPreferencesPatch,
  normalizeUiPreferencesSnapshot,
  preferencePatchForKey,
  preferenceValueFromSnapshot,
  preferenceValuesAsStrings,
  UI_PREFERENCE_KEY_LIST,
} from '../lib/uiPreferenceMapping';

type PreferenceListener = () => void;

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

/** The main-process snapshot wins in Electron; localStorage remains the browser-preview fallback and migration cache. */
export function readPreference(key: string): string | null {
  return preferenceValueFromSnapshot(latestSnapshot, key) ?? readStoredPreference(key);
}

function legacyPreferences(): UiPreferencesPatch {
  const values = Object.fromEntries(UI_PREFERENCE_KEY_LIST.map((key) => [key, readStoredPreference(key)]));
  return legacyUiPreferencesPatch(values);
}

function notifyPreference(key: string): void {
  for (const listener of listenersByKey.get(key) ?? []) listener();
}

function applySnapshot(value: UiPreferencesSnapshot): void {
  const snapshot = normalizeUiPreferencesSnapshot(value);
  if (!snapshot) return;
  if (latestSnapshot && snapshot.revision < latestSnapshot.revision) return;
  if (latestSnapshot && latestSnapshot.initialized && !snapshot.initialized) return;
  const previousValues = new Map<string, string | null>(UI_PREFERENCE_KEY_LIST.map((key) => [key, readPreference(key)] as const));
  if (latestSnapshot && snapshot.revision === latestSnapshot.revision) {
    const previous = latestSnapshot.values;
    const next = snapshot.values;
    if (snapshot.initialized !== latestSnapshot.initialized
      || previous.themeId !== next.themeId
      || previous.motion !== next.motion
      || previous.showDiscover !== next.showDiscover
      || previous.waterfall !== next.waterfall
      || previous.homeFilters !== next.homeFilters
      || previous.navMode !== next.navMode
      || previous.posterSize !== next.posterSize) return;
  } else {
    latestSnapshot = snapshot;
  }

  if (!snapshot.initialized) return;

  const values = preferenceValuesAsStrings(snapshot);
  try {
    for (const [key, preference] of Object.entries(values)) localStorage.setItem(key, preference);
  } catch {
    // The in-memory and main-process values remain available when browser storage is disabled.
  }
  for (const key of UI_PREFERENCE_KEY_LIST) {
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
  const patch = preferencePatchForKey(key, value);
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

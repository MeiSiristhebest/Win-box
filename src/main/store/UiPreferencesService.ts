import type { UiPreferences, UiPreferencesPatch, UiPreferencesSnapshot } from '../../shared/uiPreferences';
import { DEFAULT_UI_PREFERENCES, validateUiPreferencesPatch } from '../../shared/uiPreferences';
import type { JsonStore } from './JsonStore';

interface StoredUiPreferences {
  version: 1;
  revision: number;
  initialized: boolean;
  values: UiPreferences;
}

const STORAGE_KEY = 'uiPreferences';

/** Main-process owner for persistent preferences shared by all app windows. */
export class UiPreferencesService {
  private state: StoredUiPreferences;

  constructor(
    private readonly store: JsonStore,
    private readonly publish?: (snapshot: UiPreferencesSnapshot) => void,
  ) {
    const stored = store.getObject<Partial<StoredUiPreferences> | null>(STORAGE_KEY, null);
    try {
      this.state = stored?.version === 1 && stored.values
        ? {
            version: 1,
            revision: Number.isSafeInteger(stored.revision) && Number(stored.revision) >= 0 ? Number(stored.revision) : 0,
            initialized: stored.initialized === true,
            values: { ...DEFAULT_UI_PREFERENCES, ...validateUiPreferencesPatch(stored.values) },
          }
        : { version: 1, revision: 0, initialized: false, values: { ...DEFAULT_UI_PREFERENCES } };
    } catch {
      this.state = { version: 1, revision: 0, initialized: false, values: { ...DEFAULT_UI_PREFERENCES } };
    }
  }

  get(): UiPreferencesSnapshot {
    return this.snapshot();
  }

  /** Imports the renderer's legacy localStorage values once, before main storage has a value. */
  initialize(legacyValues: unknown): UiPreferencesSnapshot {
    if (this.state.initialized) return this.snapshot();
    return this.commit(validateUiPreferencesPatch(legacyValues), true);
  }

  update(value: unknown): UiPreferencesSnapshot {
    return this.commit(validateUiPreferencesPatch(value), true);
  }

  private commit(patch: UiPreferencesPatch, initialized: boolean): UiPreferencesSnapshot {
    const previous = this.state;
    const next: StoredUiPreferences = {
      version: 1,
      revision: previous.revision + 1,
      initialized: previous.initialized || initialized,
      values: { ...previous.values, ...patch },
    };
    this.store.setObject(STORAGE_KEY, next);
    try {
      this.store.flushStrict();
    } catch (error) {
      this.store.setObject(STORAGE_KEY, previous);
      try { this.store.flushStrict(); } catch { /* Keep the last published snapshot if storage is unavailable. */ }
      throw error;
    }
    this.state = next;
    const snapshot = this.snapshot();
    try { this.publish?.(snapshot); } catch { /* Window listeners may close during a settings update. */ }
    return snapshot;
  }

  private snapshot(): UiPreferencesSnapshot {
    return {
      revision: this.state.revision,
      initialized: this.state.initialized,
      values: { ...this.state.values },
    };
  }
}

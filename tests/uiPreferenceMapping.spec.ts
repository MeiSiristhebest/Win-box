import { describe, expect, it } from 'vitest';
import type { UiPreferencesSnapshot } from '../src/shared/uiPreferences';
import {
  legacyUiPreferencesPatch,
  normalizeUiPreferencesSnapshot,
  preferencePatchForKey,
  preferenceValueFromSnapshot,
  preferenceValuesAsStrings,
  UI_PREFERENCE_KEYS,
} from '../src/renderer/lib/uiPreferenceMapping';

const snapshot: UiPreferencesSnapshot = {
  revision: 7,
  initialized: true,
  values: {
    themeId: 'light',
    motion: 'off',
    showDiscover: false,
    waterfall: true,
    homeFilters: true,
    navMode: 'window',
    posterSize: 'large',
  },
};

describe('UI preference mapping', () => {
  it('normalizes complete snapshots with defaults for fields absent in older snapshots', () => {
    expect(normalizeUiPreferencesSnapshot({
      revision: 2,
      initialized: true,
      values: { themeId: 'dark', motion: 'auto', showDiscover: true, waterfall: false },
    })).toEqual({
      revision: 2,
      initialized: true,
      values: {
        themeId: 'dark', motion: 'auto', showDiscover: true, waterfall: false,
        homeFilters: false, navMode: 'inline', posterSize: 'medium',
      },
    });
  });

  it.each([
    null,
    [],
    { revision: -1, initialized: true, values: {} },
    { revision: 1.5, initialized: true, values: {} },
    { revision: 1, initialized: 'yes', values: {} },
    { revision: 1, initialized: true, values: { themeId: 'dark' } },
    { revision: 1, initialized: true, values: { themeId: 'invalid', motion: 'auto', showDiscover: true, waterfall: false } },
  ])('rejects malformed snapshot %j', (value) => {
    expect(normalizeUiPreferencesSnapshot(value)).toBeNull();
  });

  it('projects every aggregate value to the stable legacy preference keys', () => {
    expect(Object.fromEntries(Object.values(UI_PREFERENCE_KEYS).map((key) => [key, preferenceValueFromSnapshot(snapshot, key)]))).toEqual({
      [UI_PREFERENCE_KEYS.theme]: 'light',
      [UI_PREFERENCE_KEYS.discover]: '0',
      [UI_PREFERENCE_KEYS.waterfall]: '1',
      [UI_PREFERENCE_KEYS.motion]: 'off',
      [UI_PREFERENCE_KEYS.homeFilters]: '1',
      [UI_PREFERENCE_KEYS.navMode]: 'window',
      [UI_PREFERENCE_KEYS.posterSize]: 'large',
    });
    expect(preferenceValueFromSnapshot({ ...snapshot, initialized: false }, UI_PREFERENCE_KEYS.theme)).toBeNull();
    expect(preferenceValueFromSnapshot(snapshot, 'unknown')).toBeNull();
  });

  it('migrates legacy values and applies the documented defaults', () => {
    expect(legacyUiPreferencesPatch({
      [UI_PREFERENCE_KEYS.theme]: 'netflix',
      [UI_PREFERENCE_KEYS.motion]: 'off',
      [UI_PREFERENCE_KEYS.discover]: '0',
      [UI_PREFERENCE_KEYS.waterfall]: '1',
      [UI_PREFERENCE_KEYS.homeFilters]: '1',
      [UI_PREFERENCE_KEYS.navMode]: 'window',
      [UI_PREFERENCE_KEYS.posterSize]: 'large',
    })).toEqual({
      themeId: 'dark', motion: 'off', showDiscover: false, waterfall: true,
      homeFilters: true, navMode: 'window', posterSize: 'large',
    });
    expect(legacyUiPreferencesPatch({ [UI_PREFERENCE_KEYS.theme]: 'plugin:cinema-skin' }).themeId).toBe('plugin:cinema-skin');
    expect(legacyUiPreferencesPatch({}).posterSize).toBe('medium');
  });

  it('serializes and maps legacy single-key writes without touching storage', () => {
    expect(preferenceValuesAsStrings(snapshot)).toEqual({
      [UI_PREFERENCE_KEYS.theme]: 'light',
      [UI_PREFERENCE_KEYS.motion]: 'off',
      [UI_PREFERENCE_KEYS.discover]: '0',
      [UI_PREFERENCE_KEYS.waterfall]: '1',
      [UI_PREFERENCE_KEYS.homeFilters]: '1',
      [UI_PREFERENCE_KEYS.posterSize]: 'large',
      [UI_PREFERENCE_KEYS.navMode]: 'window',
    });
    expect(preferencePatchForKey(UI_PREFERENCE_KEYS.theme, 'plugin:cinema-skin')).toEqual({ themeId: 'plugin:cinema-skin' });
    expect(preferencePatchForKey(UI_PREFERENCE_KEYS.motion, 'invalid')).toEqual({ motion: 'auto' });
    expect(preferencePatchForKey(UI_PREFERENCE_KEYS.discover, '0')).toEqual({ showDiscover: false });
    expect(preferencePatchForKey(UI_PREFERENCE_KEYS.waterfall, '1')).toEqual({ waterfall: true });
    expect(preferencePatchForKey(UI_PREFERENCE_KEYS.homeFilters, '1')).toEqual({ homeFilters: true });
    expect(preferencePatchForKey(UI_PREFERENCE_KEYS.posterSize, 'invalid')).toEqual({ posterSize: 'medium' });
    expect(preferencePatchForKey(UI_PREFERENCE_KEYS.navMode, 'window')).toEqual({ navMode: 'window' });
    expect(preferencePatchForKey('unknown', 'value')).toBeNull();
  });
});

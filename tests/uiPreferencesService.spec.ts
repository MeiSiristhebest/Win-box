import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UiPreferencesService } from '../src/main/store/UiPreferencesService';
import { JsonStore } from '../src/main/store/JsonStore';
import type { UiPreferencesSnapshot } from '../src/shared/uiPreferences';

const temporaryDirectories: string[] = [];

function createService(publish?: (snapshot: UiPreferencesSnapshot) => void): UiPreferencesService {
  const directory = mkdtempSync(join(tmpdir(), 'winbox-ui-preferences-'));
  temporaryDirectories.push(directory);
  return new UiPreferencesService(new JsonStore(join(directory, 'preferences.json')), publish);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('main-process UI preference service', () => {
  it('imports legacy values once and persists a versioned snapshot', () => {
    const first = createService();
    expect(first.get()).toMatchObject({ revision: 0, initialized: false, values: { themeId: 'dark' } });
    const initialized = first.initialize({ themeId: 'apple', motion: 'off', showDiscover: false, waterfall: true });
    expect(initialized).toMatchObject({ revision: 1, initialized: true, values: { themeId: 'light', motion: 'off', showDiscover: false, waterfall: true } });
    expect(first.initialize({ themeId: 'netflix' })).toEqual(initialized);

    const reopened = new UiPreferencesService(new JsonStore(join(temporaryDirectories.at(-1)!, 'preferences.json')));
    expect(reopened.get()).toEqual(initialized);
  });

  it('rejects invalid updates without changing the published snapshot', () => {
    const publish = vi.fn();
    const observed = createService(publish);
    observed.initialize({ themeId: 'douban' });
    const before = observed.get();

    expect(() => observed.update({ themeId: 'unknown' })).toThrow('无效的主题 ID');
    expect(() => observed.update({ privateField: true })).toThrow('不支持的界面偏好字段');
    expect(observed.get()).toEqual(before);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('keeps the previous snapshot when a durable write fails', () => {
    const memory = new Map<string, unknown>();
    const store = {
      getObject: <T>(_key: string, fallback: T): T => (memory.get('uiPreferences') as T | undefined) ?? fallback,
      setObject: (_key: string, value: unknown): void => { memory.set('uiPreferences', value); },
      flushStrict: (): never => { throw new Error('disk unavailable'); },
    } as unknown as JsonStore;
    const service = new UiPreferencesService(store);
    expect(() => service.update({ themeId: 'bilibili' })).toThrow('disk unavailable');
    expect(service.get()).toMatchObject({ revision: 0, initialized: false, values: { themeId: 'dark' } });
  });
});

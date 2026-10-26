import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { JsonStore } from '../src/main/store/JsonStore';
import { DriveStore } from '../src/main/store/DriveStore';
import { NullLogger } from '../src/engine/util/logger';

const directories: string[] = [];
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'winbox-settings-write-'));
  directories.push(directory);
  const path = join(directory, 'settings.json');
  return { path, store: new JsonStore(path) };
}
afterEach(() => { directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })); });

describe('strict settings persistence', () => {
  it('keeps the previous disk and memory value when the atomic temporary file cannot be written', () => {
    const { path, store } = fixture();
    store.setObjectStrict('settings', { value: 'before' });
    const disk = readFileSync(path, 'utf8');
    mkdirSync(path + '.tmp');
    expect(() => store.setObjectStrict('settings', { value: 'after' })).toThrow();
    expect(store.getObject('settings', null)).toEqual({ value: 'before' });
    expect(readFileSync(path, 'utf8')).toBe(disk);
    expect(() => store.setObjectStrict('newKey', { value: 'after' })).toThrow();
    expect(store.get('newKey')).toBe('');
  });

  it('does not publish an updated or deleted token if its write fails', () => {
    const { path, store } = fixture();
    const credentials = new DriveStore(store, NullLogger);
    credentials.set('quark', 'before');
    expect(credentials.list()).toEqual({ quark: 'before' });
    mkdirSync(path + '.tmp');
    expect(() => credentials.set('quark', 'after')).toThrow();
    expect(credentials.list()).toEqual({ quark: 'before' });
    expect(() => credentials.remove('quark')).toThrow();
    expect(credentials.list()).toEqual({ quark: 'before' });
  });

  it('restores a deleted JSON object key when strict removal cannot be persisted', () => {
    const { path, store } = fixture();
    store.setObjectStrict('settings', { value: 'before' });
    const disk = readFileSync(path, 'utf8');
    mkdirSync(path + '.tmp');

    expect(() => store.deleteStrict('settings')).toThrow();
    expect(store.getObject('settings', null)).toEqual({ value: 'before' });
    expect(readFileSync(path, 'utf8')).toBe(disk);
  });
});

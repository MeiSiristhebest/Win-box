import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { NullLogger } from '../src/engine/util/logger';
import { DavStore } from '../src/main/store/DavStore';
import { JsonStore } from '../src/main/store/JsonStore';

const directories: string[] = [];
afterEach(() => { directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })); });

describe('DavStore strict persistence', () => {
  it('does not publish a server update or removal when the atomic write fails', () => {
    const directory = mkdtempSync(join(tmpdir(), 'winbox-dav-write-'));
    directories.push(directory);
    const path = join(directory, 'dav.json');
    const dav = new DavStore(new JsonStore(path), NullLogger);
    const original = dav.set({ id: 'nas', name: 'Home', url: 'https://nas.example/dav', username: 'user', password: 'old' });
    const diskBefore = readFileSync(path, 'utf-8');
    mkdirSync(path + '.tmp');

    expect(() => dav.set({ ...original, name: 'Changed', password: 'new' })).toThrow();
    expect(dav.get('nas')).toEqual(original);
    expect(readFileSync(path, 'utf-8')).toBe(diskBefore);

    expect(() => dav.remove('nas')).toThrow();
    expect(dav.get('nas')).toEqual(original);
    expect(readFileSync(path, 'utf-8')).toBe(diskBefore);
  });
});

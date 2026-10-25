import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DriveCredentialSynchronizer, resolveCloudDriveConfigPath } from '../src/main/drive/DriveCredentialSynchronizer';
import { wexCookiePath, wexPrefsSeedPath, pizazzCookiePath } from '../src/main/spider/driveCookieFiles';

let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'winbox-drive-sync-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('DriveCredentialSynchronizer', () => {
  it('resolves configured and proxy-wrapped Cloud-drive paths', () => {
    const sites = [{ ext: JSON.stringify({ 'Cloud-drive': 'tvfan/Cloud-drive.txt' }) }];
    expect(resolveCloudDriveConfigPath(sites, root)).toBe(join(root, 'tvfan', 'Cloud-drive.txt'));

    const wrapped = [{ ext: JSON.stringify({ 'Cloud-drive': 'http://127.0.0.1:9978/file/tvfan/Cloud%20drive.txt' }) }];
    expect(resolveCloudDriveConfigPath(wrapped, root)).toBe(join(root, 'tvfan', 'Cloud drive.txt'));
  });

  it('synchronizes one credential snapshot to the Cloud-drive, Pizazz, wex and SharedPreferences formats', () => {
    const userDataRoot = join(root, 'user-data');
    const spiderCacheRoot = join(root, 'spider-cache');
    const tempRoot = join(root, 'external');
    const cloudDrivePath = join(userDataRoot, 'tvfan', 'Cloud-drive.txt');
    const logger = { i: vi.fn(), w: vi.fn() };
    mkdirSync(join(userDataRoot, 'tvfan'), { recursive: true });
    writeFileSync(cloudDrivePath, JSON.stringify({ customSetting: 'keep-me', quarkCookie: 'stale' }), 'utf-8');

    const synchronizer = new DriveCredentialSynchronizer({
      userDataRoot,
      spiderCacheRoot,
      tempDir: tempRoot,
      sites: () => [{ ext: JSON.stringify({ 'Cloud-drive': 'tvfan/Cloud-drive.txt' }) }],
      logger,
    });
    const tokens = { quark: '__pus=Q', uc: '__pus=U' };
    synchronizer.sync(tokens, { deviceId: 'device-1', token: '{"access_token":"secret"}' });

    const cloud = JSON.parse(readFileSync(cloudDrivePath, 'utf-8')) as Record<string, unknown>;
    expect(cloud).toMatchObject({ customSetting: 'keep-me', quarkCookie: '__pus=Q', ucCookie: '__pus=U' });
    expect(JSON.parse(readFileSync(pizazzCookiePath('quark', tempRoot), 'utf-8'))).toMatchObject({ cookie: '__pus=Q' });
    expect(readFileSync(wexCookiePath('quark', join(spiderCacheRoot, 'sandbox')), 'utf-8')).toBe('__pus=Q');

    const seedPath = wexPrefsSeedPath(join(spiderCacheRoot, 'sandbox'));
    expect(existsSync(seedPath)).toBe(true);
    const seed = readFileSync(seedPath, 'utf-8');
    expect(seed).toContain('Wex_quark_cookie\t__pus=Q');
    expect(seed).toContain('Wex_ucpan_token\t{"access_token":"secret"}');
    expect(logger.i).toHaveBeenCalled();
  });

  it('removes stale mapped credentials from every backing store on a full sync', () => {
    const userDataRoot = join(root, 'user-data');
    const spiderCacheRoot = join(root, 'spider-cache');
    const tempRoot = join(root, 'external');
    const sandbox = join(spiderCacheRoot, 'sandbox');
    const logger = { i: vi.fn(), w: vi.fn() };
    const synchronizer = new DriveCredentialSynchronizer({
      userDataRoot,
      spiderCacheRoot,
      tempDir: tempRoot,
      sites: () => [{ ext: JSON.stringify({ 'Cloud-drive': 'tvfan/Cloud-drive.txt' }) }],
      logger,
    });

    synchronizer.sync({ quark: 'old' }, { deviceId: 'device-1', token: 'old-token' });
    synchronizer.sync({});

    expect(JSON.parse(readFileSync(join(userDataRoot, 'tvfan', 'Cloud-drive.txt'), 'utf-8'))).not.toHaveProperty('quarkCookie');
    expect(existsSync(pizazzCookiePath('quark', tempRoot))).toBe(false);
    expect(existsSync(wexCookiePath('quark', sandbox))).toBe(false);
    expect(readFileSync(wexPrefsSeedPath(sandbox), 'utf-8')).not.toContain('Wex_ucpan_token');
  });
});

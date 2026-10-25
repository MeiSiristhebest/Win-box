import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Logger, SourceBean } from '../../shared/types';
import { mergeCloudDriveTokens } from '../../engine/spider/driveExt';
import type { UcTvSeedInput } from '../spider/driveCookieFiles';
import {
  syncPizazzCookieFiles,
  syncWexCookieFiles,
  syncWexPrefsSeed,
  spiderSandboxDir,
  WEX_PREF_KEYS,
} from '../spider/driveCookieFiles';

export interface DriveCredentialSyncPorts {
  userDataRoot: string;
  spiderCacheRoot: string;
  sites: () => readonly Pick<SourceBean, 'ext'>[];
  logger: Pick<Logger, 'i' | 'w'>;
  tempDir?: string;
}

export function resolveCloudDriveConfigPath(
  sites: readonly Pick<SourceBean, 'ext'>[],
  userDataRoot: string,
): string {
  for (const site of sites) {
    try {
      const ext = JSON.parse(String(site.ext || '{}')) as Record<string, unknown>;
      const configuredPath = ext['Cloud-drive'];
      if (typeof configuredPath !== 'string' || !configuredPath.trim()) continue;

      let relativePath = configuredPath.trim().replace(/^\.\//, '');
      try {
        const parsed = new URL(relativePath);
        if (parsed.pathname.startsWith('/file/')) {
          relativePath = decodeURIComponent(parsed.pathname.slice('/file/'.length));
        }
      } catch {
        // Relative Cloud-drive paths are the normal configuration form.
      }
      return join(userDataRoot, relativePath.replace(/^\/+/, ''));
    } catch {
      // Invalid source ext is unrelated to credential synchronization.
    }
  }
  return join(userDataRoot, 'tvfan', 'Cloud-drive.txt');
}

export class DriveCredentialSynchronizer {
  constructor(private readonly ports: DriveCredentialSyncPorts) {}

  sync(tokens: Record<string, string>, ucTv?: UcTvSeedInput | null): void {
    this.syncCloudDriveConfig(tokens);

    const writtenPizazz = syncPizazzCookieFiles(tokens, this.ports.tempDir ?? tmpdir());
    if (writtenPizazz.length) {
      this.ports.logger.i('已同步 Pizazz 系网盘 cookie 文件：' + writtenPizazz.join(', '));
    }

    const sandbox = spiderSandboxDir(this.ports.spiderCacheRoot);
    const writtenWex = syncWexCookieFiles(tokens, sandbox);
    if (writtenWex.length) {
      const ucPath = writtenWex.find((path) => path.endsWith('.ucpancookie'));
      const ucLength = ucPath ? readFileSync(ucPath, 'utf-8').trim().length : 0;
      this.ports.logger.i(
        '已同步 wex 系网盘 cookie 文件：' + writtenWex.join(', ') +
        '（sandbox=' + sandbox + ', ucLen=' + ucLength + '）',
      );
    } else if (tokens.uc) {
      this.ports.logger.w('wex UC cookie 未写入（sandbox=' + sandbox + ', ucLen=' + tokens.uc.trim().length + '）');
    }

    const seed = syncWexPrefsSeed(tokens, sandbox, ucTv);
    if (seed) {
      const keys = Object.values(WEX_PREF_KEYS).join(',') +
        (ucTv ? ',Wex_ucpan_token,Wex_ucpan_device_id' : '');
      this.ports.logger.i('已同步 wex 系 SharedPreferences 种子：' + seed + '（键=' + keys + '）');
    }
  }

  private syncCloudDriveConfig(tokens: Record<string, string>): void {
    const path = resolveCloudDriveConfigPath(this.ports.sites(), this.ports.userDataRoot);
    let config: Record<string, unknown> = {};
    try {
      if (existsSync(path)) {
        const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          config = parsed as Record<string, unknown>;
        }
      }
    } catch {
      // A missing or damaged file is rebuilt from the current credential snapshot.
    }

    const merged = mergeCloudDriveTokens(config, tokens);
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(merged), 'utf-8');
      this.ports.logger.i('已同步 Cloud-drive 配置 -> ' + path);
    } catch (error) {
      this.ports.logger.w('写入 Cloud-drive 配置失败: ' + (error as Error).message);
    }
  }
}

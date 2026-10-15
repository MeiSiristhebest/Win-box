// tests/updateCacheReset.spec.ts — 更新后首次启动清空 winbox-cache：
//   ① 版本比对（全新安装不清 / 同版本不清 / 版本变化才清）；
//   ② 标记文件（last-run-version.json）读写，且路径在 winbox-cache 之外；
//   ③ clearWinboxCache：清空内容（含历史安装包）、保留目录自身、统计释放字节数。
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearWinboxCache } from '../src/main/util/cacheClean';
import {
  isFirstLaunchAfterUpdate,
  lastRunVersionPath,
  readLastRunVersion,
  writeLastRunVersion,
} from '../src/main/util/updateCacheReset';

const dirs: string[] = [];
function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'ucreset-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  dirs.length = 0;
});

describe('updateCacheReset — isFirstLaunchAfterUpdate（版本比对）', () => {
  it('全新安装（无历史版本）→ 不清理', () => {
    expect(isFirstLaunchAfterUpdate('', '1.21.6')).toBe(false);
  });

  it('版本相同 → 不清理', () => {
    expect(isFirstLaunchAfterUpdate('1.21.6', '1.21.6')).toBe(false);
  });

  it('版本变化 → 清理', () => {
    expect(isFirstLaunchAfterUpdate('1.21.5', '1.21.6')).toBe(true);
  });

  it('任一版本号为空 → 不清理', () => {
    expect(isFirstLaunchAfterUpdate('  ', '1.21.6')).toBe(false);
    expect(isFirstLaunchAfterUpdate('1.21.5', '')).toBe(false);
  });
});

describe('updateCacheReset — 标记文件读写', () => {
  it('路径落在 userData 根（不在 winbox-cache 内，否则会被本次清理自己删掉）', () => {
    const ud = tmpDir();
    expect(lastRunVersionPath(ud)).toBe(join(ud, 'last-run-version.json'));
  });

  it('写入后可读回；缺失 / 损坏 → 空串', () => {
    const f = join(tmpDir(), 'last-run-version.json');
    expect(readLastRunVersion(f)).toBe('');
    writeLastRunVersion(f, '1.21.6');
    expect(readLastRunVersion(f)).toBe('1.21.6');
    writeFileSync(f, '{ not json');
    expect(readLastRunVersion(f)).toBe('');
  });
});

describe('clearWinboxCache — 清空内容、保留目录', () => {
  it('清掉全部子项（含历史安装包）并统计释放字节数，目录自身保留', () => {
    const cache = join(tmpDir(), 'winbox-cache');
    mkdirSync(join(cache, 'update'), { recursive: true });
    writeFileSync(join(cache, 'update', 'Win-Box Setup 1.21.5.exe'), Buffer.alloc(2 * 1024 * 1024)); // 2MB
    mkdirSync(join(cache, 'spider', 'converted'), { recursive: true });
    writeFileSync(join(cache, 'spider', 'converted', 'a.jar'), Buffer.alloc(1024)); // 1KB
    writeFileSync(join(cache, 'spider-local.json'), '{}');

    const r = clearWinboxCache(cache);

    expect(r.failed).toEqual([]);
    expect(r.cleared).toEqual(expect.arrayContaining(['update', 'spider', 'spider-local.json']));
    expect(r.freedBytes).toBeGreaterThanOrEqual(2 * 1024 * 1024 + 1024 + 2);
    expect(existsSync(cache)).toBe(true); // 目录保留（下次使用自动重建）
    expect(readdirSync(cache)).toEqual([]); // 内容清空
  });

  it('目录不存在 → 无副作用', () => {
    const r = clearWinboxCache(join(tmpDir(), 'nope'));
    expect(r).toEqual({ freedBytes: 0, cleared: [], failed: [] });
  });
});

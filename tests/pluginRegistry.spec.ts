// tests/pluginRegistry.spec.ts — 插件登记表（临时目录 + 真 zip）：
//   user 目录扫描 / builtin 随包 zip 扫描 / 重复 id 时 user 覆盖 / 非法清单不登记。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildZip } from '../src/engine/util/syncZip';
import { HOST_API_VERSION, type PluginManifest } from '../src/shared/plugin';
import { PluginRegistry } from '../src/main/plugin/PluginRegistry';

let root: string;
let pluginsDir: string;
let builtinDir: string;

function manifest(over: Partial<PluginManifest> = {}): PluginManifest {
  return {
    manifestVersion: 1,
    id: 'super-resolution',
    name: '超分辨率',
    version: '1.0.0',
    apiVersion: HOST_API_VERSION,
    kind: 'asset',
    permissions: [],
    contributes: [{ type: 'mpv.shaders', modes: [{ id: 'efficiency', label: '效率档', shaders: ['a.glsl'] }] }],
    ...over,
  };
}

/** 往 user 目录写一个"已安装"插件目录 */
function installUserDir(id: string, m: PluginManifest): void {
  const dir = join(pluginsDir, `${id}.winbox`);
  mkdirSync(join(dir, 'files'), { recursive: true });
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify(m));
  writeFileSync(join(dir, 'files', 'a.glsl'), '// shader');
}

/** 往 builtin 目录写一个随包 .winbox zip */
function writeBuiltinZip(m: PluginManifest): void {
  mkdirSync(builtinDir, { recursive: true });
  writeFileSync(
    join(builtinDir, `${m.id}.winbox`),
    buildZip([
      { name: 'plugin.json', bytes: Buffer.from(JSON.stringify(m)) },
      { name: 'files/a.glsl', bytes: Buffer.from('// shader') },
    ]),
  );
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'winbox-registry-'));
  pluginsDir = join(root, 'plugins');
  builtinDir = join(root, 'resources', 'plugins');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('PluginRegistry — 登记', () => {
  it('目录都不存在 → 空表', async () => {
    expect(await new PluginRegistry(pluginsDir, builtinDir).list()).toEqual([]);
  });

  it('扫描 user 已安装目录：source=user、payloadReady=true、level 正确', async () => {
    installUserDir('super-resolution', manifest());
    const list = await new PluginRegistry(pluginsDir, builtinDir).list();
    expect(list.length).toBe(1);
    expect(list[0]).toMatchObject({ id: 'super-resolution', source: 'user', level: 'L1', payloadReady: true });
    expect(list[0].path).toBe(join(pluginsDir, 'super-resolution.winbox'));
  });

  it('扫描 builtin 随包 zip：source=builtin、payloadReady=false、path=zip 绝对路径', async () => {
    writeBuiltinZip(manifest());
    const list = await new PluginRegistry(pluginsDir, builtinDir).list();
    expect(list.length).toBe(1);
    expect(list[0]).toMatchObject({ id: 'super-resolution', source: 'builtin', payloadReady: false });
    expect(list[0].path).toBe(join(builtinDir, 'super-resolution.winbox'));
  });

  it('同 id 时 user 覆盖 builtin', async () => {
    writeBuiltinZip(manifest({ version: '1.0.0' }));
    installUserDir('super-resolution', manifest({ version: '2.0.0' }));
    const list = await new PluginRegistry(pluginsDir, builtinDir).list();
    expect(list.length).toBe(1);
    expect(list[0].source).toBe('user');
    expect(list[0].manifest.version).toBe('2.0.0');
  });

  it('清单非法（id 非法）的目录 / zip 一律不登记', async () => {
    installUserDir('bad', manifest({ id: 'AB' }));
    writeBuiltinZip(manifest({ id: 'CD' }));
    expect(await new PluginRegistry(pluginsDir, builtinDir).list()).toEqual([]);
  });

  it('坏 zip 字节不登记且不抛错', async () => {
    mkdirSync(builtinDir, { recursive: true });
    writeFileSync(join(builtinDir, 'broken.winbox'), Buffer.from('not a zip'));
    expect(await new PluginRegistry(pluginsDir, builtinDir).list()).toEqual([]);
  });

  it('同名但非目录的 .winbox 文件（user 侧）不登记', async () => {
    mkdirSync(pluginsDir, { recursive: true });
    writeFileSync(join(pluginsDir, 'foo.winbox'), Buffer.from('x'));
    expect(await new PluginRegistry(pluginsDir, builtinDir).list()).toEqual([]);
  });
});

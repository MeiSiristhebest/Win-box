// tests/pluginInstaller.spec.ts — `.winbox` 安装管线（真 zip ↔ 真文件系统，临时目录）：
//   解包 → 校验 → 原子落盘 `<id>.winbox/`；覆盖安装整体替换；坏包不落盘、无 tmp 残留。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildZip } from '../src/engine/util/syncZip';
import { HOST_API_VERSION, type PluginManifest } from '../src/shared/plugin';
import { PluginInstaller } from '../src/main/plugin/PluginInstaller';

let root: string;
let pluginsDir: string;

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

function winboxBytes(json: unknown, extra: Array<{ name: string; bytes: Buffer }> = []): Buffer {
  return buildZip([
    { name: 'plugin.json', bytes: Buffer.from(JSON.stringify(json)) },
    { name: 'files/a.glsl', bytes: Buffer.from('// shader') },
    ...extra,
  ]);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'winbox-plugin-'));
  pluginsDir = join(root, 'plugins');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('PluginInstaller — 安装', () => {
  it('合法 .winbox 装成 <id>.winbox/，plugin.json 与 files/ 就位', async () => {
    const r = await new PluginInstaller(pluginsDir).install(winboxBytes(manifest()));
    expect(r.ok).toBe(true);
    expect(r.id).toBe('super-resolution');
    expect(r.dir).toBe(join(pluginsDir, 'super-resolution.winbox'));
    expect(existsSync(join(pluginsDir, 'super-resolution.winbox', 'plugin.json'))).toBe(true);
    expect(existsSync(join(pluginsDir, 'super-resolution.winbox', 'files', 'a.glsl'))).toBe(true);
    expect(readFileSync(join(pluginsDir, 'super-resolution.winbox', 'files', 'a.glsl'), 'utf-8')).toBe('// shader');
    // 无 tmp/bak 残留
    expect(readdirSync(pluginsDir).some((n) => n.endsWith('.tmp') || n.endsWith('.bak'))).toBe(false);
  });

  it('覆盖安装：旧目录被整体替换（残留文件消失），版本更新', async () => {
    const inst = new PluginInstaller(pluginsDir);
    await inst.install(winboxBytes(manifest({ version: '1.0.0' })));
    // 模拟旧版里存在、新版没有的残留文件
    writeFileSync(join(pluginsDir, 'super-resolution.winbox', 'files', 'stale.glsl'), 'old');
    const r = await inst.install(winboxBytes(manifest({ version: '2.0.0' })));
    expect(r.ok).toBe(true);
    expect(existsSync(join(pluginsDir, 'super-resolution.winbox', 'files', 'stale.glsl'))).toBe(false);
    const m = JSON.parse(readFileSync(join(pluginsDir, 'super-resolution.winbox', 'plugin.json'), 'utf-8'));
    expect(m.version).toBe('2.0.0');
    expect(readdirSync(pluginsDir).some((n) => n.endsWith('.tmp') || n.endsWith('.bak'))).toBe(false);
  });

  it('坏包（非 zip）→ 失败、pluginsDir 无任何落盘', async () => {
    const r = await new PluginInstaller(pluginsDir).install(Buffer.from('not an archive'));
    expect(r.ok).toBe(false);
    expect(r.reasonCode).toBe('EMPTY_PACKAGE');
    expect(existsSync(pluginsDir)).toBe(false);
  });

  it('清单非法（id 非法）→ 拒绝安装、不落盘', async () => {
    const r = await new PluginInstaller(pluginsDir).install(winboxBytes(manifest({ id: 'AB' })));
    expect(r.ok).toBe(false);
    expect(r.reasonCode).toBe('ID_INVALID');
    expect(existsSync(join(pluginsDir, 'AB.winbox'))).toBe(false);
  });

  it('声明的着色器未随包 → MISSING_DECLARED_FILE、不落盘', async () => {
    const zip = buildZip([
      { name: 'plugin.json', bytes: Buffer.from(JSON.stringify(manifest())) },
      { name: 'README.md', bytes: Buffer.from('# 缺着色器') },
    ]);
    const r = await new PluginInstaller(pluginsDir).install(zip);
    expect(r.reasonCode).toBe('MISSING_DECLARED_FILE');
    expect(existsSync(join(pluginsDir, 'super-resolution.winbox'))).toBe(false);
  });

  it('解包器抛错 → INSTALL_IO 之外不崩（走空包路径）', async () => {
    const thrown = async (): Promise<never> => {
      throw new Error('boom');
    };
    const r = await new PluginInstaller(pluginsDir, thrown).install(Buffer.from('x'));
    expect(r.ok).toBe(false);
    expect(r.reasonCode).toBe('EMPTY_PACKAGE');
  });
});

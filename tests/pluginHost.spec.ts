// tests/pluginHost.spec.ts — 插件宿主（临时目录 + 真 zip）：
//   随包 builtin **物化**到 pluginsDir（方案 A：与用户安装同构 + 侧签）/ user 安装不被覆盖 /
//   安装·卸载·启停 / 超分档位 → 着色器**绝对路径**解析 / 未就绪一律 off。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildZip } from '../src/engine/util/syncZip';
import { HOST_API_VERSION, type PluginManifest } from '../src/shared/plugin';
import { PluginHost } from '../src/main/plugin/PluginHost';

let root: string;
let pluginsDir: string;
let builtinDir: string;
let statePath: string;

const SHADERS: Record<string, string[]> = {
  efficiency: ['a.glsl', 'b.glsl'],
  quality: ['c.glsl'],
};

function manifest(over: Partial<PluginManifest> = {}): PluginManifest {
  return {
    manifestVersion: 1,
    id: 'super-resolution',
    name: '超分辨率',
    version: '1.0.0',
    apiVersion: HOST_API_VERSION,
    kind: 'asset',
    permissions: [],
    contributes: [
      {
        type: 'mpv.shaders',
        modes: Object.entries(SHADERS).map(([id, shaders]) => ({ id, label: id === 'efficiency' ? '效率档' : '质量档', shaders })),
      },
    ],
    ...over,
  };
}

/** 构造一个真实的 .winbox zip（plugin.json + files/ 下全部着色器） */
function winbox(m: PluginManifest): Buffer {
  const files: Array<{ name: string; bytes: Buffer }> = [
    { name: 'plugin.json', bytes: Buffer.from(JSON.stringify(m)) },
  ];
  for (const list of Object.values(SHADERS)) {
    for (const s of list) files.push({ name: `files/${s}`, bytes: Buffer.from(`// ${s}`) });
  }
  return buildZip(files);
}

function writeBuiltin(m: PluginManifest): void {
  mkdirSync(builtinDir, { recursive: true });
  writeFileSync(join(builtinDir, `${m.id}.winbox`), winbox(m));
}

function host(): PluginHost {
  return new PluginHost({ pluginsDir, builtinDir, statePath });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'winbox-host-'));
  pluginsDir = join(root, 'plugins');
  builtinDir = join(root, 'resources', 'plugins');
  statePath = join(root, 'plugins-state.json');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('PluginHost — 随包 builtin 物化（方案 A）', () => {
  it('init 把随包 zip 解到 pluginsDir/<id>.winbox/ 并写侧签；列表登记为 builtin 且就位', async () => {
    writeBuiltin(manifest());
    const h = host();
    await h.init();
    const dir = join(pluginsDir, 'super-resolution.winbox');
    expect(existsSync(join(dir, 'plugin.json'))).toBe(true);
    expect(existsSync(join(dir, 'files', 'a.glsl'))).toBe(true);
    expect(existsSync(join(dir, '.builtin.json'))).toBe(true);
    const items = await h.list();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'super-resolution', source: 'builtin', level: 'L1', enabled: true, ready: true });
    expect(items[0].modes.map((m) => m.id)).toEqual(['efficiency', 'quality']);
  });

  it('随包版本变化 → 重新物化（覆盖旧目录）', async () => {
    writeBuiltin(manifest({ version: '1.0.0' }));
    const h1 = host();
    await h1.init();
    const dir = join(pluginsDir, 'super-resolution.winbox');
    writeFileSync(join(dir, 'stale.txt'), 'old');
    // 软件更新：随包 zip 升到 2.0.0
    writeBuiltin(manifest({ version: '2.0.0' }));
    const h2 = host();
    await h2.init();
    expect(existsSync(join(dir, 'stale.txt'))).toBe(false);
    expect(JSON.parse(readFileSync(join(dir, 'plugin.json'), 'utf-8')).version).toBe('2.0.0');
    expect((await h2.list())[0].version).toBe('2.0.0');
  });

  it('用户自己的同 id 安装（无侧签）→ 不被随包物化覆盖', async () => {
    // 先由"用户"装一份 9.9.9
    const h1 = host();
    await h1.installFromFile(writeTemp(manifest({ version: '9.9.9' })));
    // 再让随包出现同 id（1.0.0）
    writeBuiltin(manifest({ version: '1.0.0' }));
    const h2 = host();
    await h2.init();
    const items = await h2.list();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ source: 'user', version: '9.9.9' });
  });
});

describe('PluginHost — 安装 / 卸载 / 启停', () => {
  it('installFromFile 装用户插件（source=user），卸载删目录', async () => {
    const h = host();
    const r = await h.installFromFile(writeTemp(manifest()));
    expect(r.ok).toBe(true);
    expect(r.items?.[0]).toMatchObject({ source: 'user', ready: true });
    expect(existsSync(join(pluginsDir, 'super-resolution.winbox'))).toBe(true);
    const un = await h.uninstall('super-resolution');
    expect(un.ok).toBe(true);
    expect(existsSync(join(pluginsDir, 'super-resolution.winbox'))).toBe(false);
  });

  it('安装坏包 → ok=false 且给出可读原因，不落盘', async () => {
    const bad = join(root, 'bad.winbox');
    writeFileSync(bad, Buffer.from('not an archive'));
    const r = await host().installFromFile(bad);
    expect(r.ok).toBe(false);
    expect(r.reason).toBeTruthy();
    expect(existsSync(pluginsDir)).toBe(false);
  });

  it('启停持久化：新实例读回同一状态', async () => {
    writeBuiltin(manifest());
    const h1 = host();
    await h1.init();
    await h1.setEnabled('super-resolution', false);
    expect((await h1.list())[0].enabled).toBe(false);
    const h2 = host();
    await h2.init();
    expect((await h2.list())[0].enabled).toBe(false);
  });
});

describe('PluginHost — 超分着色器解析', () => {
  it('档位 → files/ 下的**绝对路径**（顺序保持）', async () => {
    writeBuiltin(manifest());
    const h = host();
    await h.init();
    const dir = join(pluginsDir, 'super-resolution.winbox');
    expect(await h.srShaders('efficiency')).toEqual([join(dir, 'files', 'a.glsl'), join(dir, 'files', 'b.glsl')]);
    expect(await h.srShaders('quality')).toEqual([join(dir, 'files', 'c.glsl')]);
  });

  it('off / 非法档位 / 未装插件 → 空数组', async () => {
    const none = host();
    await none.init();
    expect(await none.srShaders('efficiency')).toEqual([]);
    expect(await none.srState('efficiency')).toEqual({ available: false, modes: [], mode: 'off' });

    writeBuiltin(manifest());
    const h = host();
    await h.init();
    expect(await h.srShaders('off')).toEqual([]);
    expect(await h.srShaders('nope')).toEqual([]);
  });

  it('停用后 → 视作未就绪（srShaders 空、srState.mode=off）', async () => {
    writeBuiltin(manifest());
    const h = host();
    await h.init();
    await h.setEnabled('super-resolution', false);
    expect(await h.srShaders('efficiency')).toEqual([]);
    expect(await h.srState('efficiency')).toMatchObject({ available: false, mode: 'off' });
  });

  it('srState：可用档位随插件声明；生效档位按 usable 收敛', async () => {
    writeBuiltin(manifest());
    const h = host();
    await h.init();
    expect(await h.srState('quality')).toMatchObject({ available: true, mode: 'quality' });
    expect((await h.srState('quality')).modes.map((m) => m.label)).toEqual(['效率档', '质量档']);
    expect(await h.srState('general')).toMatchObject({ mode: 'off' }); // 插件没这档 → off
  });

  it('着色器文件缺失 → 不返回不存在的路径', async () => {
    writeBuiltin(manifest());
    const h = host();
    await h.init();
    rmSync(join(pluginsDir, 'super-resolution.winbox', 'files', 'b.glsl'));
    expect(await h.srShaders('efficiency')).toEqual([join(pluginsDir, 'super-resolution.winbox', 'files', 'a.glsl')]);
  });
});

/** 把 .winbox 写到临时文件并返回路径 */
function writeTemp(m: PluginManifest): string {
  const p = join(root, `${m.id}-${m.version}.winbox`);
  writeFileSync(p, winbox(m));
  return p;
}

describe('PluginHost — 插件皮肤（contributes.theme）', () => {
  const themeManifest = (over: Partial<PluginManifest> = {}): PluginManifest =>
    manifest({
      id: 'sakura-skin',
      name: '樱花皮肤',
      contributes: [
        {
          type: 'theme', id: 'sakura', label: '🌸 樱花', base: 'dark',
          tokens: { '--accent': '#e879a6', '--surface-0': '#120d12' },
          layout: { nav: 'top', density: 'comfy' },
        },
      ],
      ...over,
    });

  it('声明 theme 且已启用 → 返回 plugin:<skinId> + 令牌 + layout', async () => {
    writeBuiltin(themeManifest());
    const h = host();
    await h.init();
    expect(await h.themeSkins()).toEqual([
      {
        id: 'plugin:sakura',
        pluginId: 'sakura-skin',
        label: '🌸 樱花',
        base: 'dark',
        tokens: { '--accent': '#e879a6', '--surface-0': '#120d12' },
        layout: { nav: 'top', density: 'comfy' },
      },
    ]);
  });

  it('停用 → 不参与皮肤列表', async () => {
    writeBuiltin(themeManifest());
    const h = host();
    await h.init();
    await h.setEnabled('sakura-skin', false);
    expect(await h.themeSkins()).toEqual([]);
  });

  it('只声明 mpv.shaders 的插件 → 无皮肤', async () => {
    writeBuiltin(manifest());
    const h = host();
    await h.init();
    expect(await h.themeSkins()).toEqual([]);
  });

  it('磁盘清单被篡改（词表外令牌）→ 跳过装配（内容级兜底）', async () => {
    writeBuiltin(themeManifest());
    const h1 = host();
    await h1.init();
    const pj = join(pluginsDir, 'sakura-skin.winbox', 'plugin.json');
    const m = JSON.parse(readFileSync(pj, 'utf-8')) as { contributes: Array<{ tokens: Record<string, string> }> };
    m.contributes[0].tokens = { '--nf-red': '#e50914' };
    writeFileSync(pj, JSON.stringify(m));
    const h2 = host();
    await h2.init();
    expect(await h2.themeSkins()).toEqual([]);
  });
});

describe('PluginHost — 目录整洁', () => {
  it('物化/安装后 pluginsDir 无 .tmp/.bak 残留', async () => {
    writeBuiltin(manifest());
    const h = host();
    await h.init();
    expect(readdirSync(pluginsDir).some((n) => n.endsWith('.tmp') || n.endsWith('.bak'))).toBe(false);
  });
});

// tests/pluginContract.spec.ts — 插件清单契约校验（纯函数）：
//   ① validatePluginManifest 的逐条约束（id / apiVersion / kind↔permissions / main /
//      contributes 白名单与 kind 匹配 / 运行库许可清单 / 路径安全 / updateCheckUrl）；
//   ② 分级与档位取值；
//   ③ 交叉校验：仓库内的超分示例清单必须通过宿主契约校验。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  validatePluginManifest,
  isSafeRelPath,
  pluginLevelOf,
  shadersForMode,
  shaderModes,
  HOST_API_VERSION,
  DEP_ALLOWLIST,
  type PluginManifest,
} from '../src/shared/plugin';

function base(over: Partial<PluginManifest> = {}): PluginManifest {
  return {
    manifestVersion: 1,
    id: 'demo-plugin',
    name: '演示插件',
    version: '1.0.0',
    apiVersion: HOST_API_VERSION,
    kind: 'asset',
    permissions: [],
    contributes: [{ type: 'mpv.shaders', modes: [{ id: 'efficiency', label: '效率档', shaders: ['a.glsl'] }] }],
    ...over,
  };
}

describe('plugin 契约 — validatePluginManifest', () => {
  it('合法 asset 清单通过', () => {
    expect(validatePluginManifest(base())).toEqual({ ok: true });
  });

  it('缺清单 / manifestVersion 错 → MISSING_MANIFEST', () => {
    expect(validatePluginManifest(null).reasonCode).toBe('MISSING_MANIFEST');
    expect(validatePluginManifest(base({ manifestVersion: 2 })).reasonCode).toBe('MISSING_MANIFEST');
  });

  it('id 非法 → ID_INVALID', () => {
    for (const bad of ['AB', 'a', '-abc', 'abc-', '中文id', 'a b']) {
      expect(validatePluginManifest(base({ id: bad })).reasonCode).toBe('ID_INVALID');
    }
  });

  it('apiVersion 主版本不匹配 → API_VERSION_MISMATCH', () => {
    expect(validatePluginManifest(base({ apiVersion: '2.x' })).reasonCode).toBe('API_VERSION_MISMATCH');
    expect(validatePluginManifest(base({ apiVersion: '1.9' })).ok).toBe(true);
  });

  it('asset 带 permissions / 带 main → KIND_PERM_MISMATCH', () => {
    expect(validatePluginManifest(base({ permissions: ['net'] })).reasonCode).toBe('KIND_PERM_MISMATCH');
    expect(validatePluginManifest(base({ main: 'main.js' })).reasonCode).toBe('KIND_PERM_MISMATCH');
  });

  it('code 缺 permissions / 缺 main → KIND_PERM_MISMATCH / PATH_ESCAPE', () => {
    const codeNoPerm = base({ kind: 'code', main: 'main.js', permissions: [] });
    expect(validatePluginManifest(codeNoPerm).reasonCode).toBe('KIND_PERM_MISMATCH');
    const codeNoMain = base({ kind: 'code', permissions: ['net'] });
    expect(validatePluginManifest(codeNoMain).reasonCode).toBe('PATH_ESCAPE');
  });

  it('禁用 / 未收录权限 → UNKNOWN_PERMISSION', () => {
    const bad = base({ kind: 'code', main: 'main.js', permissions: ['cred'] });
    expect(validatePluginManifest(bad).reasonCode).toBe('UNKNOWN_PERMISSION');
  });

  it('未知 contributes / kind 不匹配 → UNKNOWN_CONTRIBUTE / UNKNOWN_CONTRIBUTE_KIND', () => {
    expect(validatePluginManifest(base({ contributes: [{ type: 'code.spider' }] })).reasonCode).toBe('UNKNOWN_CONTRIBUTE');
    expect(validatePluginManifest(base({ contributes: [{ type: 'player.engine' }] })).reasonCode).toBe('UNKNOWN_CONTRIBUTE_KIND');
  });

  it('shader 名称路径逃逸 → PATH_ESCAPE', () => {
    const bad = base({ contributes: [{ type: 'mpv.shaders', modes: [{ id: 'x', label: 'X', shaders: ['../a.glsl'] }] }] });
    expect(validatePluginManifest(bad).reasonCode).toBe('PATH_ESCAPE');
  });

  it('运行库不在许可清单 → DEP_NOT_ALLOWED', () => {
    expect(validatePluginManifest(base({ runtimeDeps: [{ id: 'not-allowlisted' }] })).reasonCode).toBe('DEP_NOT_ALLOWED');
    expect(validatePluginManifest(base({ runtimeDeps: [{ id: 'anime4k-shaders' }] })).ok).toBe(true);
  });

  it('updateCheckUrl 非 https → BAD_UPDATE_URL', () => {
    expect(validatePluginManifest(base({ updateCheckUrl: 'http://x/latest.json' })).reasonCode).toBe('BAD_UPDATE_URL');
  });

  it('isSafeRelPath：拒绝绝对路径 / .. / 盘符', () => {
    expect(isSafeRelPath('a/b.glsl')).toBe(true);
    expect(isSafeRelPath('a\\b.glsl')).toBe(true);
    expect(isSafeRelPath('../a.glsl')).toBe(false);
    expect(isSafeRelPath('/etc/passwd')).toBe(false);
    expect(isSafeRelPath('C:/x')).toBe(false);
    expect(isSafeRelPath('a/../../b')).toBe(false);
    expect(isSafeRelPath('')).toBe(false);
  });
});

describe('plugin 契约 — 分级与档位', () => {
  it('asset 按 contributes 取级别；code 恒为 L4', () => {
    expect(pluginLevelOf(base())).toBe('L1');
    expect(pluginLevelOf(base({ contributes: [{ type: 'ui.slot' }] }))).toBe('L3');
    expect(pluginLevelOf(base({ kind: 'code', main: 'm.js', permissions: ['net'] }))).toBe('L4');
  });

  it('档位取值保持顺序', () => {
    const c = [{ type: 'mpv.shaders', modes: [{ id: 'q', label: '质量档', shaders: ['a.glsl', 'b.glsl'] }] }];
    expect(shadersForMode(c, 'mpv.shaders', 'q')).toEqual(['a.glsl', 'b.glsl']);
    expect(shadersForMode(c, 'mpv.shaders', 'nope')).toEqual([]);
    expect(shaderModes(c, 'mpv.shaders').map((m) => m.label)).toEqual(['质量档']);
  });

  it('许可清单含首批三套着色器 dep', () => {
    for (const id of ['anime4k-shaders', 'ravu-lite-shaders', 'fsrcnnx-shaders']) {
      expect(DEP_ALLOWLIST[id]).toBeTruthy();
    }
  });
});

describe('plugin 契约 — 示例清单校验', () => {
  it('仓库内的超分示例清单必须通过宿主契约校验', () => {
    const p = fileURLToPath(
      new URL('./fixtures/example-super-resolution.plugin.json', import.meta.url),
    );
    const m = JSON.parse(readFileSync(p, 'utf-8')) as unknown;
    const r = validatePluginManifest(m);
    expect(r).toEqual({ ok: true });
    // 四档位（效率/质量/通用/高质量）都在
    expect(shaderModes((m as PluginManifest).contributes, 'mpv.shaders').map((x) => x.id))
      .toEqual(['efficiency', 'quality', 'general', 'high']);
  });
});

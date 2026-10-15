// tests/pluginPackage.spec.ts — `.winbox` **包级**校验（纯函数）：
//   根级 plugin.json / 条目路径安全 / 随包着色器存在性 / 清单级错误透传。
import { describe, it, expect } from 'vitest';
import { HOST_API_VERSION, type PluginManifest } from '../src/shared/plugin';
import { validatePluginPackage, normalizeEntryName, type PackageEntry } from '../src/shared/pluginPackage';

const u8 = (s: string): Uint8Array => new TextEncoder().encode(s);

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

/** 默认：plugin.json + files/a.glsl（声明的着色器随包） */
function pkg(over: { json?: unknown; extra?: PackageEntry[] } = {}): PackageEntry[] {
  const json = over.json === undefined ? manifest() : over.json;
  return [
    { name: 'plugin.json', bytes: u8(JSON.stringify(json)) },
    { name: 'files/a.glsl', bytes: u8('// shader') },
    ...(over.extra ?? []),
  ];
}

describe('pluginPackage — normalizeEntryName', () => {
  it('反斜杠归一、去前导 ./、目录项剔除', () => {
    expect(normalizeEntryName('files\\a.glsl')).toBe('files/a.glsl');
    expect(normalizeEntryName('./plugin.json')).toBe('plugin.json');
    expect(normalizeEntryName('files/')).toBe('');
  });
});

describe('pluginPackage — validatePluginPackage', () => {
  it('合法包通过并回传 manifest', () => {
    const r = validatePluginPackage(pkg());
    expect(r.ok).toBe(true);
    expect(r.manifest?.id).toBe('super-resolution');
  });

  it('目录项 / ./ 前缀不影响判定', () => {
    const entries = pkg().map((e) => ({ ...e, name: `./${e.name}` }));
    entries.push({ name: 'files/', bytes: new Uint8Array(0) });
    expect(validatePluginPackage(entries).ok).toBe(true);
  });

  it('空包 / 全目录项 → EMPTY_PACKAGE', () => {
    expect(validatePluginPackage([]).reasonCode).toBe('EMPTY_PACKAGE');
    expect(validatePluginPackage([{ name: 'files/', bytes: new Uint8Array(0) }]).reasonCode).toBe('EMPTY_PACKAGE');
  });

  it('缺根级 plugin.json → MANIFEST_NOT_ROOT', () => {
    const r = validatePluginPackage([{ name: 'files/a.glsl', bytes: u8('x') }]);
    expect(r.reasonCode).toBe('MANIFEST_NOT_ROOT');
  });

  it('多套一层目录的 plugin.json → MANIFEST_NOT_ROOT（提示多套目录层）', () => {
    const r = validatePluginPackage([{ name: 'super-resolution/plugin.json', bytes: u8('{}') }]);
    expect(r.reasonCode).toBe('MANIFEST_NOT_ROOT');
    expect(r.reason).toContain('根级');
  });

  it('plugin.json 非 JSON → BAD_JSON', () => {
    expect(validatePluginPackage([{ name: 'plugin.json', bytes: u8('not json') }]).reasonCode).toBe('BAD_JSON');
  });

  it('条目路径逃逸（..）→ UNSAFE_ENTRY_PATH', () => {
    const r = validatePluginPackage([...pkg(), { name: '../evil.glsl', bytes: u8('x') }]);
    expect(r.reasonCode).toBe('UNSAFE_ENTRY_PATH');
  });

  it('声明的着色器未随包 → MISSING_DECLARED_FILE', () => {
    const entries = pkg().filter((e) => e.name !== 'files/a.glsl');
    expect(validatePluginPackage(entries).reasonCode).toBe('MISSING_DECLARED_FILE');
  });

  it('清单级错误（id 非法）原样透传 reasonCode', () => {
    const r = validatePluginPackage(pkg({ json: manifest({ id: 'AB' }), extra: [] }));
    expect(r.reasonCode).toBe('ID_INVALID');
  });
});

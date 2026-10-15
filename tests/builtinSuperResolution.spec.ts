// tests/builtinSuperResolution.spec.ts — 随包官方超分插件包（`resources/plugins/super-resolution.winbox`）回归：
//   用**宿主真实校验器**（zip → extractArchiveEntries → validatePluginPackage）核对 shipped 产物，
//   防止「清单改了但包没重打」「声明的着色器漏打」这类漂移（dogfood 产出的包必须持续可过）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extractArchiveEntries } from '../src/main/subtitle/archive';
import { validatePluginPackage } from '../src/shared/pluginPackage';
import { pluginLevelOf, shaderModes } from '../src/shared/plugin';

const WINBOX = fileURLToPath(new URL('../resources/plugins/super-resolution.winbox', import.meta.url));

describe('随包官方插件 super-resolution.winbox', () => {
  it('通过宿主包级校验（根级 plugin.json + 声明着色器全部随包）', async () => {
    const entries = await extractArchiveEntries(readFileSync(WINBOX));
    expect(entries.length).toBeGreaterThan(0);
    const v = validatePluginPackage(entries);
    expect(v.reason).toBeUndefined();
    expect(v.ok).toBe(true);
  });

  it('清单：id/kind/permissions/级别 + 四档位齐备且每档非空', async () => {
    const entries = await extractArchiveEntries(readFileSync(WINBOX));
    const m = validatePluginPackage(entries).manifest!;
    expect(m.id).toBe('super-resolution');
    expect(m.kind).toBe('asset');
    expect(m.permissions).toEqual([]);
    expect(m.runtimeDeps ?? []).toEqual([]); // 官方插件载荷随包 → 不声明运行库
    expect(pluginLevelOf(m)).toBe('L1');
    const modes = shaderModes(m.contributes, 'mpv.shaders');
    expect(modes.map((x) => x.id)).toEqual(['efficiency', 'quality', 'general', 'high']);
    for (const mode of modes) expect(mode.shaders.length).toBeGreaterThan(0);
  });

  it('包内条目名全部为安全相对路径，且没有多套目录层', async () => {
    const entries = await extractArchiveEntries(readFileSync(WINBOX));
    const names = entries.map((e) => e.name);
    expect(names).toContain('plugin.json');
    for (const n of names) {
      expect(n.startsWith('/')).toBe(false);
      expect(n.includes('..')).toBe(false);
    }
  });
});

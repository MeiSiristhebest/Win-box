// Shipped shader add-ons are separately installable packages. Validate the
// actual archives, not only the example manifest, so the built-in catalog and
// package contents cannot drift apart.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extractArchiveEntries } from '../src/main/subtitle/archive';
import { validatePluginPackage } from '../src/shared/pluginPackage';
import { pluginLevelOf, shaderModes } from '../src/shared/plugin';

const SHIPPED = [
  { file: 'super-resolution.winbox', id: 'super-resolution', modes: ['efficiency', 'quality'] },
  { file: 'ravu-lite.winbox', id: 'ravu-lite', modes: ['general'] },
  { file: 'fsrcnnx-upscaler.winbox', id: 'fsrcnnx-upscaler', modes: ['high'] },
] as const;

async function shippedPackages() {
  return Promise.all(SHIPPED.map(async (plugin) => {
    const path = fileURLToPath(new URL(`../resources/plugins/${plugin.file}`, import.meta.url));
    const entries = await extractArchiveEntries(readFileSync(path));
    const validation = validatePluginPackage(entries);
    expect(validation.reason).toBeUndefined();
    expect(validation.ok).toBe(true);
    expect(validation.manifest).toBeTruthy();
    return { plugin, entries, manifest: validation.manifest! };
  }));
}

describe('内置实时超分插件包', () => {
  it('每个随包插件都通过宿主校验且声明的着色器完整', async () => {
    const packages = await shippedPackages();
    for (const { plugin, entries, manifest } of packages) {
      expect(entries.length).toBeGreaterThan(0);
      expect(manifest.id).toBe(plugin.id);
      expect(manifest.kind).toBe('asset');
      expect(manifest.permissions).toEqual([]);
      expect(manifest.runtimeDeps ?? []).toEqual([]);
      expect(pluginLevelOf(manifest)).toBe('L1');
      expect(shaderModes(manifest.contributes, 'mpv.shaders').map((mode) => mode.id)).toEqual(plugin.modes);
      for (const mode of shaderModes(manifest.contributes, 'mpv.shaders')) expect(mode.shaders.length).toBeGreaterThan(0);
    }
  });

  it('把 Anime4K、RAVU Lite、FSRCNNX 作为独立可安装插件提供四种档位', async () => {
    const packages = await shippedPackages();
    const modes = packages.flatMap(({ manifest }) => shaderModes(manifest.contributes, 'mpv.shaders'));
    expect(modes.map((mode) => mode.id)).toEqual(['efficiency', 'quality', 'general', 'high']);
  });

  it('各插件包条目名都使用安全相对路径', async () => {
    const packages = await shippedPackages();
    for (const { entries } of packages) {
      const names = entries.map((entry) => entry.name);
      expect(names).toContain('plugin.json');
      for (const name of names) {
        expect(name.startsWith('/')).toBe(false);
        expect(name.includes('..')).toBe(false);
      }
    }
  });
});

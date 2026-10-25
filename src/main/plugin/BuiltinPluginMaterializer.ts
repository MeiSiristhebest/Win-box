import { join } from 'node:path';
import { BUILTIN_MARKER, type PluginEntry, type PluginRegistry } from './PluginRegistry';
import type { PluginInstaller } from './PluginInstaller';

export interface BuiltinPluginMaterializerPorts {
  listPackagedPlugins(): Promise<PluginEntry[]>;
  installArchive(archive: Buffer): Promise<{ ok: boolean; dir?: string }>;
  exists(path: string): boolean;
  readFile(path: string): Buffer;
  writeFile(path: string, contents: string): void;
  now(): number;
}

/** Materializes packaged plugin archives into the writable plugin directory. */
export class BuiltinPluginMaterializer {
  constructor(
    private readonly pluginsDir: string,
    private readonly ports: BuiltinPluginMaterializerPorts,
  ) {}

  async materialize(): Promise<void> {
    // listBuiltin bypasses user-over-builtin de-duplication so packaged versions remain visible.
    const packaged = await this.ports.listPackagedPlugins();
    for (const entry of packaged) {
      if (entry.source !== 'builtin' || entry.payloadReady) continue;
      const archivePath = entry.path;
      if (!this.ports.exists(archivePath)) continue;

      const installedDir = join(this.pluginsDir, entry.id + '.winbox');
      const hasMarker = this.ports.exists(join(installedDir, BUILTIN_MARKER));
      // A user-installed plugin with the same id has no marker and must not be overwritten.
      if (this.ports.exists(installedDir) && !hasMarker) continue;
      if (hasMarker && this.readMarkerVersion(installedDir) === entry.manifest.version) continue;

      const installed = await this.ports.installArchive(this.ports.readFile(archivePath));
      if (!installed.ok || !installed.dir) continue;
      try {
        this.ports.writeFile(
          join(installed.dir, BUILTIN_MARKER),
          JSON.stringify({ version: entry.manifest.version, materializedAt: this.ports.now() }, null, 2),
        );
      } catch {
        // A missing marker makes the operation safely repeat on the next launch.
      }
    }
  }

  private readMarkerVersion(directory: string): string {
    try {
      const marker = JSON.parse(this.ports.readFile(join(directory, BUILTIN_MARKER)).toString('utf8')) as { version?: unknown };
      return typeof marker.version === 'string' ? marker.version : '';
    } catch {
      return '';
    }
  }
}

/** Bind the domain ports to the current registry, installer and filesystem. */
export function createBuiltinPluginMaterializer(
  pluginsDir: string,
  registry: Pick<PluginRegistry, 'listBuiltin'>,
  installer: Pick<PluginInstaller, 'install'>,
  filesystem: Pick<BuiltinPluginMaterializerPorts, 'exists' | 'readFile' | 'writeFile'>,
): BuiltinPluginMaterializer {
  return new BuiltinPluginMaterializer(pluginsDir, {
    listPackagedPlugins: () => registry.listBuiltin(),
    installArchive: (archive) => installer.install(archive),
    ...filesystem,
    now: () => Date.now(),
  });
}

/** I/O needed to apply the converted-jar cache format policy. */
export interface ConvertedJarCacheVersionPorts {
  exists(path: string): boolean;
  createDirectory(path: string): void;
  readText(path: string): string;
  writeText(path: string, contents: string): void;
  listEntries(directory: string): string[];
  removeFile(directory: string, name: string): void;
  info(message: string): void;
  warn(message: string): void;
}

/**
 * Preserve valid cache contents when the version stamp is absent, but invalidate
 * cached jar files when an existing stamp identifies an older output format.
 * Filesystem and logging effects stay in the caller-provided adapter.
 */
export function ensureConvertedJarCacheVersion(
  cacheDir: string,
  stampPath: string,
  version: number,
  ports: ConvertedJarCacheVersionPorts,
): void {
  try {
    if (!ports.exists(cacheDir)) {
      ports.createDirectory(cacheDir);
      ports.writeText(stampPath, String(version));
      return;
    }

    const currentVersion = ports.exists(stampPath) ? ports.readText(stampPath).trim() : '';
    if (currentVersion === String(version)) return;

    if (!currentVersion) {
      // A missing stamp usually means a cache-only cleanup, so keep usable jars.
      ports.writeText(stampPath, String(version));
      return;
    }

    let removed = 0;
    for (const entry of ports.listEntries(cacheDir)) {
      if (!entry.endsWith('.jar')) continue;
      try {
        ports.removeFile(cacheDir, entry);
        removed += 1;
      } catch {
        // Continue invalidating the remaining entries; a failed deletion is best effort.
      }
    }
    ports.writeText(stampPath, String(version));
    if (removed > 0) {
      ports.info(`jvm-bridge 转换产物格式升级（v${currentVersion} → v${version}），已作废 ${removed} 个旧产物并重新转换`);
    }
  } catch (error) {
    ports.warn(`jvm-bridge 缓存版本检查失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

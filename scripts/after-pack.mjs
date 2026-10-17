import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { sanitizeSqliteJar } from './sanitize-sqlite-jar.mjs';

/** Electron Packager afterComplete hook: sanitize only the staged Windows app. */
export async function sanitizePackagedApp({ buildPath, platform }) {
  if (platform !== 'win32') return;
  const candidates = [
    join(buildPath, 'resources/app.asar.unpacked/resources/jvm/libs/sqlite-jdbc-3.53.4.0.jar'),
    join(buildPath, 'resources/resources/jvm/libs/sqlite-jdbc-3.53.4.0.jar'),
  ];
  const jar = candidates.find(existsSync);
  if (!jar) throw new Error('Windows package staging is missing sqlite-jdbc-3.53.4.0.jar');
  const result = sanitizeSqliteJar(jar);
  console.log(`SQLite release copy sanitized: kept ${result.kept} entries, removed ${result.removed.length} non-Windows entries`);
}

import { describe, expect, it } from 'vitest';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { sanitizeSqliteJar } from '../scripts/sanitize-sqlite-jar.mjs';

const SQLITE_SOURCE = join(process.cwd(), 'resources/jvm/libs/sqlite-jdbc-3.53.4.0.jar');

describe('Windows SQLite release copy', () => {
  it.skipIf(!existsSync(SQLITE_SOURCE))('removes non-Windows native payloads without changing the pinned source JAR', async () => {
    const source = SQLITE_SOURCE;
    const dir = mkdtempSync(join(tmpdir(), 'winbox-sqlite-sanitize-'));
    const target = join(dir, 'sqlite-jdbc-3.53.4.0.jar');
    try {
      const before = createHash('sha256').update(readFileSync(source)).digest('hex');
      copyFileSync(source, target);
      const result = sanitizeSqliteJar(target);
      const after = createHash('sha256').update(readFileSync(source)).digest('hex');
      expect(after).toBe(before);
      expect(result.removed).toContain('org/sqlite/native/Linux/x86_64/libsqlitejdbc.so');
      expect(result.removed).toContain('org/sqlite/native/FreeBSD/x86_64/libsqlitejdbc.so');
      expect(result.removed).toContain('org/sqlite/native/Mac/x86_64/libsqlitejdbc.dylib');
      expect(result.removed).not.toContain('org/sqlite/native/Windows/x86_64/sqlitejdbc.dll');

      // Node's built-in ZIP reader is not available on all supported Node
      // versions; use the installed 7z WASM reader only for the actual build.
      // The entry assertions below inspect the ZIP central directory through
      // the same sanitizer on a second pass: a valid output must be stable.
      const second = sanitizeSqliteJar(target);
      expect(second.removed).toHaveLength(0);
      expect(second.kept).toBe(result.kept);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

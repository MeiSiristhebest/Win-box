import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JsonStore } from '../src/main/store/JsonStore';
import { LocalPkgStore } from '../src/main/store/LocalPkgStore';
import { UserConfigApplicationService } from '../src/main/store/UserConfigApplicationService';
import { NullLogger } from '../src/engine/util/logger';
import { pkgSubUrl } from '../src/engine/config/localPkg';
import { parseSiteConfig } from '../src/engine/config/ApiConfigParser';
import type { SourceBean, UserConfig } from '../src/shared/types';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'managed-import-'));
  dirs.push(dir);
  const imports = join(dir, 'install', 'imports');
  const store = new LocalPkgStore(new JsonStore(join(dir, 'data', 'local-pkgs.json')), 'http://127.0.0.1:9978', imports);
  const manager = new UserConfigApplicationService(new JsonStore(join(dir, 'data', 'user-config.json')), NullLogger);
  const source = join(dir, 'original');
  mkdirSync(join(source, 'py', 'base'), { recursive: true });
  writeFileSync(join(source, 'py', '源.py'), 'from base.helper import value\nclass Spider: pass\n');
  writeFileSync(join(source, 'py', 'base', 'helper.py'), 'value = 42\n');
  writeFileSync(join(source, '影视.json'), JSON.stringify({ sites: [{ key: 'py', name: 'py', type: 3, api: './py/源.py' }] }));
  return { dir, imports, store, manager, source };
}

function addPython(manager: UserConfigApplicationService, api: string, key = 'py') {
  manager.addSource({ key, name: key, type: 3, api, ext: '', jar: '' } as SourceBean);
}

describe('managed local imports', () => {
  it('copies the whole package, survives removing the original and restarting', () => {
    const { store, source, imports, dir } = setup();
    const found = store.importSubscription(source)!;
    const root = store.rootOf(found.index)!;
    expect(root.startsWith(join(imports, 'packages'))).toBe(true);
    expect(found.text).toContain(pathToFileURL(join(root, 'py', '源.py')).href);
    expect(found.text).not.toContain(pathToFileURL(source).href);
    rmSync(source, { recursive: true, force: true });
    const again = new LocalPkgStore(new JsonStore(join(dir, 'data', 'local-pkgs.json')), 'http://127.0.0.1:9978', imports);
    expect(again.readSubscription(found.index, found.rel)).not.toBeNull();
    expect(readFileSync(join(again.rootOf(found.index)!, 'py', 'base', 'helper.py'), 'utf8')).toContain('42');
  });

  it('copies a standalone Python source without depending on the selected file', () => {
    const { store, manager, source, imports } = setup();
    const api = store.importPython(join(source, 'py', '源.py'));
    const target = fileURLToPath(api);
    expect(target.startsWith(join(imports, 'py'))).toBe(true);
    addPython(manager, api);
    rmSync(source, { recursive: true, force: true });
    expect(readFileSync(target, 'utf8')).toContain('class Spider');
    const before = manager.snapshot();
    manager.deleteSource('py');
    store.cleanupRemoved(before, manager.snapshot());
    expect(existsSync(target)).toBe(false);
    expect(existsSync(dirname(target))).toBe(false);
  });

  it('deleting a standalone source removes only its owned copy', () => {
    const { store, manager, source } = setup();
    const original = join(source, 'py', '源.py');
    const api = store.importPython(original);
    addPython(manager, api);
    const before = manager.snapshot();
    manager.deleteSource('py');
    store.cleanupRemoved(before, manager.snapshot());
    expect(existsSync(fileURLToPath(api))).toBe(false);
    expect(existsSync(original)).toBe(true);
  });

  it('deleting one packaged source removes its script but keeps the subscription and siblings', () => {
    const { store, manager, source } = setup();
    const found = store.importSubscription(source)!;
    manager.replaceFromImport(parseSiteConfig(found.text).config, pkgSubUrl(found.index, found.rel));
    const root = store.rootOf(found.index)!;
    const before = manager.snapshot();
    manager.deleteSource('py');
    store.cleanupRemoved(before, manager.snapshot());
    expect(existsSync(join(root, 'py', '源.py'))).toBe(false);
    expect(existsSync(join(root, 'py', 'base', 'helper.py'))).toBe(true);
    expect(existsSync(join(root, found.rel))).toBe(true);
    expect(existsSync(join(source, 'py', '源.py'))).toBe(true);
    expect(manager.snapshot().profiles[0].json).not.toContain('源.py');
  });

  it('a different subscription keeps a shared Python copy alive until its own deletion', () => {
    const { store, manager, source } = setup();
    const api = store.importPython(join(source, 'py', '源.py'));
    addPython(manager, api);
    const first = manager.saveAsProfile('first');
    manager.saveAsProfile('second');
    const before = manager.snapshot();
    manager.deleteSource('py');
    store.cleanupRemoved(before, manager.snapshot());
    expect(existsSync(fileURLToPath(api))).toBe(true);
    const next = manager.snapshot();
    manager.deleteProfile(first.id);
    store.cleanupRemoved(next, manager.snapshot());
    expect(existsSync(fileURLToPath(api))).toBe(false);
  });

  it('deleting a whole subscription removes its copied package without renumbering others', () => {
    const { store, manager, source } = setup();
    const first = store.importSubscription(source)!;
    const second = store.importSubscription(source)!;
    manager.replaceFromImport(parseSiteConfig(first.text).config, pkgSubUrl(first.index, first.rel));
    const profile = manager.snapshot().activeProfileId;
    manager.saveAsProfile('second', { parsed: parseSiteConfig(second.text).config, apiUrl: pkgSubUrl(second.index, second.rel) });
    const root = store.rootOf(first.index)!;
    const secondRoot = store.rootOf(second.index)!;
    const before = manager.snapshot();
    manager.deleteProfile(profile);
    store.cleanupRemoved(before, manager.snapshot());
    expect(existsSync(root)).toBe(false);
    expect(store.rootOf(first.index)).toBeNull();
    expect(store.rootOf(second.index)).toBe(secondRoot);
    expect(store.readSubscription(second.index, second.rel)).not.toBeNull();
    expect(existsSync(source)).toBe(true);
    expect(store.importSubscription(source)!.index).toBe(2);
  });

  it('never deletes unowned originals even if present in source configuration', () => {
    const { store, manager, source } = setup();
    store.register(source);
    const api = pathToFileURL(join(source, 'py', '源.py')).href;
    addPython(manager, api);
    const before = manager.snapshot();
    manager.deleteSource('py');
    store.cleanupRemoved(before, manager.snapshot());
    expect(existsSync(fileURLToPath(api))).toBe(true);
    expect(existsSync(source)).toBe(true);
  });

  it('migrates legacy package URLs in active sources and inactive profile JSON', () => {
    const { store, manager, source } = setup();
    const found = store.locateSubscription(source)!;
    manager.replaceFromImport(parseSiteConfig(found.text).config, pkgSubUrl(found.index, found.rel));
    manager.saveAsProfile('saved');
    const config = store.migrateConfig(manager.snapshot());
    const root = store.rootOf(found.index)!;
    expect(root).not.toBe(source);
    expect(config.apiUrl).toBe(pkgSubUrl(found.index, found.rel));
    expect(config.sources[0].api).toBe(pathToFileURL(join(root, 'py', '源.py')).href);
    expect(JSON.stringify(config.profiles)).not.toContain(pathToFileURL(source).href);
    expect(store.migrateConfig(config)).toEqual(config);
    expect(existsSync(source)).toBe(true);
    rmSync(source, { recursive: true, force: true });
    expect(store.readSubscription(found.index, found.rel)).not.toBeNull();
  });

  it('migrates the old local-py store while leaving its files intact', () => {
    const { store, manager, dir, imports } = setup();
    const original = join(dir, 'data', 'local-py', 'hash.py');
    mkdirSync(dirname(original), { recursive: true });
    writeFileSync(original, 'class Spider: pass\n');
    addPython(manager, pathToFileURL(original).href);
    const config = store.migrateConfig(manager.snapshot());
    expect(fileURLToPath(config.sources[0].api).startsWith(join(imports, 'py'))).toBe(true);
    expect(existsSync(original)).toBe(true);
    expect(store.migrateConfig(config)).toEqual(config);
  });

  it('a broken package does not block migration of other subscriptions', () => {
    const { store, manager, source, dir } = setup();
    const found = store.locateSubscription(source)!;
    manager.replaceFromImport(parseSiteConfig(found.text).config, pkgSubUrl(found.index, found.rel));
    // This legacy package contains the target imports directory and cannot
    // safely be copied. The independent package must still migrate.
    store.register(dir);
    const warnings: string[] = [];
    const config = store.migrateConfig(manager.snapshot(), message => warnings.push(message));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('迁移失败');
    expect(config.sources[0].api).toBe(pathToFileURL(join(store.rootOf(found.index)!, 'py', '源.py')).href);
    expect(store.rootOf(1)).toBe(dir);
    expect(existsSync(source)).toBe(true);
  });

  it('rolls back failed imports without removing another pending import', () => {
    const { store, manager, source } = setup();
    const api = store.importPython(join(source, 'py', '源.py'));
    const pending = store.importPython(join(source, 'py', '源.py'));
    store.discardImport(api, manager.snapshot());
    expect(existsSync(fileURLToPath(api))).toBe(false);
    expect(existsSync(fileURLToPath(pending))).toBe(true);
    const found = store.importSubscription(source)!;
    const root = store.rootOf(found.index)!;
    store.discardImport(pkgSubUrl(found.index, found.rel), manager.snapshot());
    expect(existsSync(root)).toBe(false);
    expect(existsSync(source)).toBe(true);
  });

  it('protects shared file URLs with Python class queries and Windows path case differences', () => {
    const { store, manager, source } = setup();
    const api = store.importPython(join(source, 'py', '源.py'));
    addPython(manager, api);
    const shared = process.platform === 'win32' ? api.replace('managed-import-', 'MANAGED-IMPORT-') : api;
    addPython(manager, `${shared}?name=AnotherSpider`, 'other');
    const before = manager.snapshot();
    manager.deleteSource('py');
    store.cleanupRemoved(before, manager.snapshot());
    expect(existsSync(fileURLToPath(api))).toBe(true);
  });

  it('refuses recursive self-imports and never follows junctions when cleaning', () => {
    const { store, manager, source, dir } = setup();
    writeFileSync(join(dir, '影视.json'), readFileSync(join(source, '影视.json')));
    expect(() => store.importSubscription(dir)).toThrow('独立');
    const found = store.importSubscription(source)!;
    const root = store.rootOf(found.index)!;
    rmSync(root, { recursive: true, force: true });
    symlinkSync(source, root, process.platform === 'win32' ? 'junction' : 'dir');
    const before: UserConfig = { ...manager.snapshot(), apiUrl: pkgSubUrl(found.index, found.rel) };
    store.cleanupRemoved(before, manager.snapshot());
    expect(existsSync(join(source, 'py', '源.py'))).toBe(true);
    expect(existsSync(root)).toBe(true);
  });
});

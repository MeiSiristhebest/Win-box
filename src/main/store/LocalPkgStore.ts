// src/main/store/LocalPkgStore.ts
// ★ 2026-09-29（用户要求）：本地包登记表（<userData>/local-pkgs.json）。
//
// 为什么需要登记：导入本地包后，订阅里展开出的 `http://127.0.0.1:9978/pkg/<i>/<rel>`
// 要能被 LocalProxyServer 反查到真实目录；且重启后仍要有效（磁盘持久化）。
// Imports are copied to the application's imports directory; originals are never deleted.
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { UserConfig } from '../../shared/types';
import type { JsonStore } from './JsonStore';
import {
  findPkgSubscription,
  normalizePkgRoot,
  pkgRootKey,
  registerPkg,
  resolvePkgFile,
  rewritePkgPaths,
  type LocalPkgEntry,
} from '../../engine/config/localPkg';

export const LOCAL_PKG_KEY = 'pkgs';
const LOCAL_PY_KEY = 'owned-python';

/** Includes inactive subscriptions, so shared imports survive deleting one source. */
function references(config: UserConfig): string[] {
  const out: string[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      out.push(value);
      if (/^\s*[[{]/.test(value)) {
        try { visit(JSON.parse(value)); } catch { /* non-JSON extension */ }
      }
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(config);
  return out;
}

function localFile(value: string): string | null {
  if (!/^file:\/\//i.test(value)) return null;
  try {
    const url = new URL(value);
    url.search = ''; url.hash = '';
    return fileURLToPath(url);
  } catch { return null; }
}

function inside(root: string, file: string): boolean {
  const rel = relative(resolve(root), resolve(file));
  return !!rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** SpiderHost 侧的最小依赖面（结构类型，便于单测注入假实现） */
export interface LocalPkgAccess {
  /** 包根（/pkg 路由与 py 就地运行用）；未登记返回 null */
  rootOf(index: number): string | null;
  /** 读包内订阅文本（已展开相对路径）；未登记/文件缺失返回 null */
  readSubscription(index: number, rel: string): { text: string; warnings: string[] } | null;
  migrateConfig?(config: UserConfig, warn?: (message: string) => void): UserConfig;
  cleanupRemoved?(before: UserConfig, after: UserConfig): void;
}

export class LocalPkgStore implements LocalPkgAccess {
  constructor(
    private store: JsonStore,
    /** 本地代理基址（`http://127.0.0.1:9978`） */
    private proxyBase: string,
    private importsDir = join(dirname(store.filePath), 'imports'),
    /** Builds before 1.21.01 stored copies beside the executable. */
    private legacyImportsDir = '',
  ) {}

  list(): LocalPkgEntry[] {
    const raw: unknown = this.store.getObject<unknown>(LOCAL_PKG_KEY, []);
    if (!Array.isArray(raw)) return [];
    return raw
      .map((e) => (e && typeof e === 'object' ? (e as Partial<LocalPkgEntry>) : null))
      // Tombstones keep /pkg/<index> stable after a package is deleted.
      .map((e) => ({ ...e, root: normalizePkgRoot(e?.root || ''), name: e?.name || basename(e?.root || ''), addedAt: e?.addedAt || '' }));
  }

  /** 登记（幂等）→ 返回包下标 */
  register(root: string): number {
    const { list, index } = registerPkg(this.list(), root);
    this.store.setObject(LOCAL_PKG_KEY, list);
    return index;
  }

  rootOf(index: number): string | null {
    const e = this.list()[index];
    return e?.root || null;
  }

  private save(entries: LocalPkgEntry[]): void {
    this.store.setObject(LOCAL_PKG_KEY, entries);
    this.store.flush();
  }

  /** Copy the entire package, preserving Python imports and all sibling resources. */
  importSubscription(root: string, generatedName?: string): ReturnType<LocalPkgStore['locateSubscription']> {
    const source = resolve(root);
    const subscription = this.inspectSubscription(source);
    if (!subscription) return null;
    if (subscription.generated) subscription.rel = generatedJsonName(generatedName || '');
    const target = join(this.importsDir, 'packages', randomUUID());
    this.copyPackage(source, target);
    try {
      // Generated subscriptions are intentionally written only to the managed
      // copy. The user's original .py-only directory remains untouched.
      if (!existsSync(join(target, subscription.rel))) {
        writeFileSync(join(target, subscription.rel), subscription.text, { encoding: 'utf-8', flag: 'wx' });
      }
      const found = this.locateSubscription(target);
      if (!found) throw new Error('复制后的本地包没有可用订阅');
      const entries = this.list();
      entries[found.index] = { ...entries[found.index], name: basename(source), managed: true, sourceRoot: source };
      this.save(entries);
      return found;
    } catch (e) {
      rmSync(target, { recursive: true, force: true });
      throw e;
    }
  }

  /** Inspect a directory without registering it or copying any files. */
  inspectSubscription(root: string): ReturnType<typeof findPkgSubscription> {
    const source = resolve(root);
    const files = this.packageFiles(source);
    return findPkgSubscription(files, name => {
      const abs = resolvePkgFile(source, name);
      return abs && existsSync(abs) ? readFileSync(abs, 'utf-8') : '';
    });
  }

  /** Return all regular files relative to a package root (directories omitted). */
  private packageFiles(root: string): string[] {
    const out: string[] = [];
    const visit = (dir: string, prefix: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) visit(join(dir, entry.name), rel);
        else if (entry.isFile()) out.push(rel);
        else if (entry.isSymbolicLink()) out.push(rel);
      }
    };
    try { visit(root, ''); } catch { return []; }
    return out;
  }

  private copyPackage(source: string, target: string): void {
    // Refuse recursive self-imports and symlinks/junctions into outside folders.
    if (resolve(source) === resolve(this.importsDir) || inside(source, this.importsDir)) {
      throw new Error('请选择独立的本地包目录，不要选择安装目录或 imports 的上级目录');
    }
    mkdirSync(dirname(target), { recursive: true });
    try {
      cpSync(source, target, { recursive: true, filter: path => {
        if (lstatSync(path).isSymbolicLink()) throw new Error('本地包包含符号链接，请先将链接内容复制为普通文件');
        return true;
      } });
    } catch (e) {
      rmSync(target, { recursive: true, force: true });
      throw e;
    }
  }

  importPython(source: string): string {
    const content = readFileSync(source);
    if (!content.length) throw new Error('所选 .py 文件为空');
    const target = join(this.importsDir, 'py', randomUUID(), basename(source));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
    // A scanner may quarantine an imported script immediately.  Fail at the
    // import boundary with an actionable message instead of saving a source
    // that later reports the misleading “本地 .py 文件不存在”.
    try {
      const copied = existsSync(target) ? readFileSync(target) : null;
      if (!copied || copied.length !== content.length || !copied.equals(content)) {
        rmSync(dirname(target), { recursive: true, force: true });
        throw new Error('本地 .py 副本写入后不可读取，可能已被杀毒软件隔离；请先检查安全软件的隔离记录后重试');
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes('杀毒软件')) throw e;
      rmSync(dirname(target), { recursive: true, force: true });
      throw new Error('本地 .py 副本校验失败，可能已被杀毒软件隔离；请先检查安全软件的隔离记录后重试');
    }
    this.store.setObject(LOCAL_PY_KEY, [...this.store.getObject<string[]>(LOCAL_PY_KEY, []), target]);
    this.store.flush();
    return pathToFileURL(target).href;
  }

  private owned(file: string): boolean {
    if (!inside(this.importsDir, file)) return false;
    // The lexical check alone is insufficient if an owned folder is replaced
    // with a junction. Check its physical location before any deletion.
    try {
      let existing = file;
      while (!existsSync(existing)) {
        const parent = dirname(existing);
        if (parent === existing) return false;
        existing = parent;
      }
      return inside(realpathSync(this.importsDir), realpathSync(existing));
    }
    catch { return false; }
  }

  cleanupRemoved(before: UserConfig, after: UserConfig): void {
    const oldRefs = references(before);
    const refs = references(after);
    const files = new Set(refs.map(localFile).filter((f): f is string => !!f).map(pkgRootKey));
    const entries = this.list();
    const python = this.store.getObject<string[]>(LOCAL_PY_KEY, []);
    for (const value of oldRefs) {
      const file = localFile(value);
      if (!file || files.has(pkgRootKey(file)) || !this.owned(file)) continue;
      const isPython = /\.py$/i.test(file);
      const registered = python.some(p => pkgRootKey(p) === pkgRootKey(file)) || entries.some(e => e.managed && e.root && inside(e.root, file));
      if (isPython && registered) rmSync(file, { force: true });
    }
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      if (!entry.managed || !entry.root || !this.owned(entry.root)) continue;
      const referencesEntry = (value: string) => value.startsWith(`pkg://${index}/`) ||
        value.includes(`${this.proxyBase.replace(/\/$/, '')}/pkg/${index}/`) ||
        (() => { const file = localFile(value); return !!file && inside(entry.root, file); })();
      if (oldRefs.some(referencesEntry) && !refs.some(referencesEntry)) {
        rmSync(entry.root, { recursive: true, force: true });
        entries[index] = { ...entry, root: '' };
      }
    }
    const retained = python.filter(file => {
      if (files.has(pkgRootKey(file)) || !oldRefs.some(value => {
        const old = localFile(value);
        return old && pkgRootKey(old) === pkgRootKey(file);
      }) || !this.owned(file)) return true;
      if (!this.owned(dirname(file))) return true;
      rmSync(dirname(file), { recursive: true, force: true });
      return false;
    });
    this.store.setObject(LOCAL_PY_KEY, retained);
    this.save(entries);
  }

  /** Roll back only this failed import, never another concurrent import. */
  discardImport(reference: string, config: UserConfig): void {
    this.cleanupRemoved({ ...config, apiUrl: reference }, config);
  }

  /** Upgrade old in-place packages without changing their stable pkg:// index. */
  migrateConfig(config: UserConfig, warn: (message: string) => void = () => {}): UserConfig {
    const replacements: Array<[string, string]> = [];
    const entries = this.list();
    for (const entry of entries) {
      if (entry.managed) {
        // Also repair persisted file URLs if a previous startup copied the
        // package but exited before the user-config store was flushed.
        if (entry.root && entry.sourceRoot) replacements.push([
          pathToFileURL(entry.sourceRoot).href + '/', pathToFileURL(entry.root).href + '/',
        ]);
        continue;
      }
      if (!entry.root || !existsSync(entry.root)) continue;
      const source = entry.root;
      const target = join(this.importsDir, 'packages', randomUUID());
      try { this.copyPackage(source, target); }
      catch (e) {
        warn(`本地包副本迁移失败（原文件保留）：${source} — ${String(e)}`);
        continue;
      }
      replacements.push([pathToFileURL(source).href + '/', pathToFileURL(target).href + '/']);
      entry.root = target; entry.sourceRoot = source; entry.managed = true;
      this.save(entries);
    }
    // Standalone scripts from the old local-py store already belong to the app;
    // copy them too, but leave old files intact during migration.
    const legacyRoots = [join(dirname(this.store.filePath), 'local-py'), this.legacyImportsDir]
      .filter((root, i, all) => !!root && all.indexOf(root) === i);
    for (const value of references(config)) {
      const file = localFile(value);
      if (file && legacyRoots.some(root => inside(root, file)) && existsSync(file) &&
        // A managed package has already been copied above; do not duplicate
        // each of its sibling .py files as standalone imports.
        !replacements.some(([from]) => pathToFileURL(file).href.startsWith(from)) &&
        !replacements.some(([from]) => from === pathToFileURL(file).href)) {
        try { replacements.push([pathToFileURL(file).href, this.importPython(file)]); }
        catch (e) { warn(`Python 副本迁移失败（原文件保留）：${file} — ${String(e)}`); }
      }
    }
    let json = JSON.stringify(config);
    for (const [from, to] of replacements) json = json.split(from).join(to);
    this.save(entries);
    return JSON.parse(json) as UserConfig;
  }

  /**
   * 读包内订阅：读原始文本 → `rewritePkgPaths` 展开相对路径 → 返回新文本。
   * 包根不存在 / 订阅文件不存在 → null（调用方上屏"重新导入该包"）。
   */
  readSubscription(index: number, rel: string): { text: string; warnings: string[] } | null {
    const root = this.rootOf(index);
    if (!root || !existsSync(root)) return null;
    const abs = resolvePkgFile(root, rel);
    if (!abs || !existsSync(abs)) return null;
    try {
      const text = readFileSync(abs, 'utf-8');
      const out = rewritePkgPaths(text, { index, root, proxyBase: this.proxyBase });
      return { text: out.text, warnings: out.warnings };
    } catch {
      return null;
    }
  }

  /**
   * 在包根顶层找订阅 JSON（导入用；**顺带完成登记**，返回的 index 即 `/pkg/<i>/` 的下标）。
   * @returns index + rel 文件名 + 展开后的文本 + 命中条数 + 相对引用告警；找不到返回 null
   */
  locateSubscription(
    root: string,
  ): { index: number; rel: string; text: string; warnings: string[]; sites: number } | null {
    const r = normalizePkgRoot(root);
    if (!existsSync(r)) return null;
    let files: string[] = [];
    try {
      files = this.packageFiles(r);
    } catch {
      return null;
    }
    const found = findPkgSubscription(files, (name) => {
      const abs = resolvePkgFile(r, name);
      return abs && existsSync(abs) ? readFileSync(abs, 'utf-8') : '';
    });
    if (!found) return null;
    const index = this.register(r);
    const out = rewritePkgPaths(found.text, { index, root: r, proxyBase: this.proxyBase });
    return { index, rel: found.rel, text: out.text, warnings: out.warnings, sites: found.sites };
  }
}

/** 用户命名的自动生成订阅文件名：只保留文件名，不允许目录穿越或 Windows 保留字符。 */
function generatedJsonName(value: string): string {
  const rawName = String(value || '').trim();
  const name = [...rawName]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 0x20 || '<>:"/\\|?*'.includes(character) ? '_' : character;
    })
    .join('')
    .replace(/[. ]+$/g, '')
    .replace(/^\.+$/, '');
  if (!name) throw new Error('本地 Python 包名称不能为空或不合法');
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
    throw new Error('此名称是 Windows 保留文件名，请换一个名称');
  }
  if (name.toLowerCase() === '.json') throw new Error('请填写 JSON 文件名，不能只有扩展名');
  return name.toLowerCase().endsWith('.json') ? name : `${name}.json`;
}

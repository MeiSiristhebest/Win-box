import type { ConfigImportResult, LiveBean, SourceBean, UserConfig } from '../../shared/types';
import { nameFromLocalFile } from '../util/importNaming';

export interface LocalPythonCopyPort {
  copyPython(sourcePath: string): string;
  discard(reference: string, currentConfig: UserConfig): void;
}

export interface LocalSourceRegistrationPort {
  addSource(source: SourceBean): SourceBean;
  getSnapshot(): UserConfig;
}

export interface LocalPackageInspection {
  generated?: boolean;
  sites: number;
}

export interface ImportedLocalPackage {
  index: number;
  rel: string;
  sites: number;
  warnings: string[];
}

export interface LocalPackageFilesPort {
  inspect(root: string): LocalPackageInspection | null;
  copyAndRegister(root: string, name?: string): ImportedLocalPackage | null;
  rootOf(index: number): string | null;
  discard(reference: string, currentConfig: UserConfig): void;
}

export interface LocalSubscriptionImportPort {
  importConfig(input: { url: string; name: string }): Promise<ConfigImportResult>;
}

export interface LocalLiveImportFilePort {
  import(path: string, nameOverride: string): { fileName: string; name: string; needsName: boolean };
}

export interface LocalLiveRegistrationPort {
  add(channel: LiveBean): { index: number; replaced: boolean };
  count(): number;
}

export interface LocalImportLoggerPort {
  warn(message: string): void;
}

export interface LocalImportApplicationOptions {
  pythonFiles: LocalPythonCopyPort;
  sources: LocalSourceRegistrationPort;
  packages: LocalPackageFilesPort;
  subscriptions: LocalSubscriptionImportPort;
  liveFiles: LocalLiveImportFilePort;
  liveChannels: LocalLiveRegistrationPort;
  packageUrl(index: number, rel: string): string;
  liveChannel(name: string, fileName: string): LiveBean;
  logger: LocalImportLoggerPort;
}

/** Narrow surface required by the IPC adapter. */
export interface LocalImportApplicationPort {
  importPythonFiles(paths: readonly string[]): LocalPythonImportResult;
  importPackage(root: string, requestedName?: string): Promise<LocalPackageImportResult>;
  importLiveFile(path: string, requestedName?: string): LocalLiveImportResult;
}

export interface LocalPythonImportFailure {
  name: string;
  error: string;
}

export interface LocalPythonImportResult {
  ok: boolean;
  key?: string;
  keys?: string[];
  imported?: number;
  failed?: LocalPythonImportFailure[];
  error?: string;
}

export interface LocalPackageImportResult {
  ok: boolean;
  root?: string;
  rel?: string;
  sites?: number;
  name?: string;
  needsName?: boolean;
  error?: string;
  warnings?: string[];
  result?: ConfigImportResult;
}

export interface LocalLiveImportResult {
  ok: boolean;
  needsName?: boolean;
  path?: string;
  name?: string;
  index?: number;
  replaced?: boolean;
  total?: number;
  error?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Coordinates local-file import workflows without depending on Electron or concrete storage. */
export class LocalImportApplicationService implements LocalImportApplicationPort {
  constructor(private readonly options: LocalImportApplicationOptions) {}

  /** Each selected Python file has an independent commit/compensation boundary. */
  importPythonFiles(paths: readonly string[]): LocalPythonImportResult {
    const keys: string[] = [];
    const failed: LocalPythonImportFailure[] = [];

    for (const path of paths) {
      const name = nameFromLocalFile(path);
      let importedApi = '';
      try {
        importedApi = this.options.pythonFiles.copyPython(path);
        const source = this.options.sources.addSource({
          key: name,
          name,
          type: 3,
          api: importedApi,
          ext: '',
          jar: '',
        } as SourceBean);
        keys.push(source.key);
      } catch (error) {
        let failure = errorMessage(error);
        if (importedApi) {
          try {
            // Read the current root immediately before compensation. A stale snapshot
            // could delete an asset another config transaction has just referenced.
            this.options.pythonFiles.discard(importedApi, this.options.sources.getSnapshot());
          } catch (cleanupError) {
            const detail = errorMessage(cleanupError);
            this.options.logger.warn(`本地 Python 副本清理失败：${detail}`);
            failure += `；副本清理失败：${detail}`;
          }
        }
        failed.push({ name, error: failure });
      }
    }

    const error = failed.length
      ? `${failed.length} 个文件导入失败：${failed.map(item => `${item.name}（${item.error}）`).join('；')}`
      : undefined;
    if (!keys.length) return { ok: false, failed, error };
    return {
      ok: true,
      key: keys[0],
      keys,
      imported: keys.length,
      failed: failed.length ? failed : undefined,
      error,
    };
  }

  /** First call can request a name without copying; the named retry performs the import. */
  async importPackage(root: string, requestedName?: string): Promise<LocalPackageImportResult> {
    let importedUrl = '';
    const nameOverride = String(requestedName || '').trim();
    try {
      const inspected = this.options.packages.inspect(root);
      if (inspected?.generated && !nameOverride) {
        return { ok: false, needsName: true, root, sites: inspected.sites };
      }

      const name = nameFromLocalFile(root, nameOverride);
      const found = this.options.packages.copyAndRegister(root, nameOverride);
      if (!found) {
        return {
          ok: false,
          error: '该目录下没找到订阅 JSON 或可导入的 .py 文件：请选择含影视.json（或含 sites 的 .json）的本地包，或包含 Python 源脚本的文件夹',
        };
      }

      importedUrl = this.options.packageUrl(found.index, found.rel);
      const result = await this.options.subscriptions.importConfig({ url: importedUrl, name });
      return {
        ok: true,
        root: this.options.packages.rootOf(found.index) || root,
        rel: found.rel,
        sites: found.sites,
        name,
        warnings: found.warnings,
        result,
      };
    } catch (error) {
      const warnings: string[] = [];
      if (importedUrl) {
        try {
          this.options.packages.discard(importedUrl, this.options.sources.getSnapshot());
        } catch (cleanupError) {
          const detail = errorMessage(cleanupError);
          warnings.push(`本地包副本清理失败：${detail}`);
          this.options.logger.warn(warnings[0]);
        }
      }
      return { ok: false, error: errorMessage(error), warnings: warnings.length ? warnings : undefined };
    }
  }

  /** Stores/validates the selected file first, then registers only after naming is complete. */
  importLiveFile(path: string, requestedName?: string): LocalLiveImportResult {
    try {
      const imported = this.options.liveFiles.import(path, String(requestedName || '').trim());
      if (imported.needsName) return { ok: true, needsName: true, path, name: imported.name };

      const registered = this.options.liveChannels.add(this.options.liveChannel(imported.name, imported.fileName));
      return {
        ok: true,
        name: imported.name,
        index: registered.index,
        replaced: registered.replaced,
        total: this.options.liveChannels.count(),
      };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }
}

import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { HttpClient } from '../../shared/types';
import { md5Hex } from '../../engine/util/md5';
import type { PythonSpiderScriptLoadResult, PythonSpiderScriptPort, PythonSpiderScriptStatus } from '../../engine/spider/PythonSpiderScriptPort';

export interface PythonSpiderScriptAdapterOptions {
  cacheDirectory: string;
  http: HttpClient;
}

/** Main-process adapter for resolving, downloading, and caching remote or local Python scripts. */
export class PythonSpiderScriptAdapter implements PythonSpiderScriptPort {
  private readonly inFlight = new Map<string, Promise<PythonSpiderScriptLoadResult>>();

  constructor(private readonly options: PythonSpiderScriptAdapterOptions) {}

  status(apiBase: string): PythonSpiderScriptStatus {
    const location = this.locate(apiBase);
    if (!location) return null;
    return { path: location.path, available: this.isAvailable(location.path, location.local) };
  }

  load(apiBase: string): Promise<PythonSpiderScriptLoadResult> {
    const location = this.locate(apiBase);
    if (!location) {
      return Promise.resolve({
        status: 'failed',
        code: apiBase.startsWith('file://') ? 'INVALID_FILE_URL' : 'INVALID_ADDRESS',
        detail: apiBase.startsWith('file://') ? apiBase : undefined,
      });
    }
    if (this.isAvailable(location.path, location.local)) {
      return Promise.resolve({ status: 'ready', path: location.path });
    }
    if (location.local) {
      return Promise.resolve({ status: 'failed', code: 'LOCAL_SCRIPT_MISSING' });
    }

    const existing = this.inFlight.get(apiBase);
    if (existing) return existing;

    const loading = this.download(apiBase, location.path).finally(() => {
      if (this.inFlight.get(apiBase) === loading) this.inFlight.delete(apiBase);
    });
    this.inFlight.set(apiBase, loading);
    return loading;
  }

  private locate(apiBase: string): { path: string; local: boolean } | null {
    if (apiBase.startsWith('file://')) {
      try {
        return { path: fileURLToPath(apiBase), local: true };
      } catch {
        return null;
      }
    }
    if (!/^https?:\/\//i.test(apiBase)) return null;
    return { path: join(this.options.cacheDirectory, `${md5Hex(apiBase)}.py`), local: false };
  }

  private isAvailable(path: string, local: boolean): boolean {
    try {
      return existsSync(path) && (local || statSync(path).size > 0);
    } catch {
      return false;
    }
  }

  private async download(apiBase: string, scriptPath: string): Promise<PythonSpiderScriptLoadResult> {
    try {
      mkdirSync(this.options.cacheDirectory, { recursive: true });
      const response = await this.options.http.request({ url: apiBase, method: 'get', timeoutMs: 60000, buffer: 2 });
      const bytes = Buffer.from(
        Array.isArray(response.content) ? response.content : Buffer.from(String(response.content), 'base64'),
      );
      if (bytes.length < 8) return { status: 'failed', code: 'SCRIPT_EMPTY' };
      writeFileSync(scriptPath, bytes);
      return { status: 'ready', path: scriptPath };
    } catch (error) {
      return {
        status: 'failed',
        code: 'SCRIPT_DOWNLOAD_FAILED',
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

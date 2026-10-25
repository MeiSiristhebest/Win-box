import type { SpiderCallResult } from './spiderCallResult';

/** Runtime capabilities consumed by a Python source; no JVM or archive-conversion API. */
export interface PythonSpiderRuntimePort {
  pyRuntimeReady(): boolean;
  prewarmPythonRuntime(): Promise<string>;
  prewarmPython(path: string, className: string, count: number, extend: string, sourceKey: string): number;
  callPython(path: string, className: string, method: string, args: string[], timeoutMs?: number, sourceKey?: string, signal?: AbortSignal): Promise<SpiderCallResult>;
}

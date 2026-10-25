export type PythonSpiderScriptFailureCode =
  | 'INVALID_ADDRESS'
  | 'INVALID_FILE_URL'
  | 'LOCAL_SCRIPT_MISSING'
  | 'SCRIPT_EMPTY'
  | 'SCRIPT_DOWNLOAD_FAILED';

export type PythonSpiderScriptStatus = {
  path: string;
  available: boolean;
} | null;

export type PythonSpiderScriptLoadResult =
  | { status: 'ready'; path: string }
  | { status: 'failed'; code: PythonSpiderScriptFailureCode; detail?: string };

/** Loads and caches source scripts outside the Python process/runtime adapter. */
export interface PythonSpiderScriptPort {
  status(apiBase: string): PythonSpiderScriptStatus;
  load(apiBase: string): Promise<PythonSpiderScriptLoadResult>;
}

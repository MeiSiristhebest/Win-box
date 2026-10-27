import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export interface RuntimePathInfo {
  isSymbolicLink(): boolean;
  isDirectory(): boolean;
  isFile(): boolean;
  size: number;
  mtimeMs?: number;
}

/** Minimal filesystem surface so canonical-path and reparse checks can be tested without Windows admin rights. */
export interface RuntimePathSafetyPort {
  lstat(path: string): RuntimePathInfo;
  realpath(path: string): string;
}

export interface RuntimeTreeEntry {
  name: string;
  isSymbolicLink(): boolean;
}

export interface RuntimeTreeFilesystemPort extends RuntimePathSafetyPort {
  readdir(path: string): RuntimeTreeEntry[];
}

export interface AsyncRuntimeTreeFilesystemPort {
  lstat(path: string): Promise<RuntimePathInfo>;
  realpath(path: string): Promise<string>;
  readdir(path: string): Promise<RuntimeTreeEntry[]>;
}

export interface MediaRuntimeExpansionBudget {
  maxEntries: number;
  maxBytes: number;
  maxDepth: number;
}

export const DEFAULT_MEDIA_RUNTIME_EXPANSION_BUDGET: MediaRuntimeExpansionBudget = {
  maxEntries: 100_000,
  maxBytes: 2 * 1024 * 1024 * 1024,
  maxDepth: 32,
};

export function isPathWithin(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel));
}

/** Resolve a path only when every existing component below the trusted root is a real directory/file. */
export function resolveContainedRealPath(
  trustedRoot: string,
  candidate: string,
  filesystem: RuntimePathSafetyPort,
): string {
  const root = filesystem.realpath(trustedRoot);
  const lexicalCandidate = resolve(candidate);
  if (!isPathWithin(root, lexicalCandidate)) throw new Error('媒体组件路径越出应用数据目录');

  const rel = relative(root, lexicalCandidate);
  let current = root;
  for (const part of rel.split(sep).filter(Boolean)) {
    current = resolve(current, part);
    const info = filesystem.lstat(current);
    if (info.isSymbolicLink()) throw new Error('媒体组件路径包含符号链接或 Windows reparse point');
  }

  const actual = filesystem.realpath(lexicalCandidate);
  if (!isPathWithin(root, actual)) throw new Error('媒体组件实际路径越出应用数据目录');
  return actual;
}

/** Ensure pre-existing parent directories are not links before a mkdir/write is attempted. */
export function assertNoReparsePointPrefix(
  trustedRoot: string,
  candidate: string,
  filesystem: RuntimePathSafetyPort,
): void {
  const root = filesystem.realpath(trustedRoot);
  const lexicalCandidate = resolve(candidate);
  if (!isPathWithin(root, lexicalCandidate)) throw new Error('媒体组件路径越出应用数据目录');
  const rel = relative(root, lexicalCandidate);
  let current = root;
  for (const part of rel.split(sep).filter(Boolean)) {
    current = resolve(current, part);
    let info: RuntimePathInfo;
    try { info = filesystem.lstat(current); }
    catch (error) {
      if (isMissingPathError(error)) return;
      throw error;
    }
    if (info.isSymbolicLink()) throw new Error('媒体组件路径包含符号链接或 Windows reparse point');
  }
}

/** Reject expanded archives whose entry count, aggregate file size, or directory depth is excessive. */
export function enforceMediaRuntimeExpansionBudget(
  extractedRoot: string,
  filesystem: RuntimeTreeFilesystemPort,
  signal?: AbortSignal,
  budget: MediaRuntimeExpansionBudget = DEFAULT_MEDIA_RUNTIME_EXPANSION_BUDGET,
): { entries: number; bytes: number } {
  if (filesystem.lstat(extractedRoot).isSymbolicLink()) throw new Error('发行包解压目录不能是符号链接或 Windows reparse point');
  const root = filesystem.realpath(extractedRoot);
  let entries = 0;
  let bytes = 0;

  const walk = (directory: string, depth: number): void => {
    if (signal?.aborted) throw new Error('已取消下载');
    for (const entry of filesystem.readdir(directory)) {
      if (signal?.aborted) throw new Error('已取消下载');
      entries += 1;
      if (entries > budget.maxEntries) throw new Error(`发行包展开条目超过安全上限（${budget.maxEntries}）`);
      const path = join(directory, entry.name);
      const info = filesystem.lstat(path);
      if (entry.isSymbolicLink() || info.isSymbolicLink()) throw new Error('发行包展开目录包含符号链接或 Windows reparse point');
      const actual = filesystem.realpath(path);
      if (!isPathWithin(root, actual)) throw new Error('发行包展开路径越出临时目录');
      const childDepth = depth + 1;
      if (childDepth > budget.maxDepth) throw new Error(`发行包目录深度超过安全上限（${budget.maxDepth}）`);
      if (info.isDirectory()) {
        walk(actual, childDepth);
      } else if (info.isFile()) {
        if (!Number.isSafeInteger(info.size) || info.size < 0) throw new Error('发行包文件大小无效');
        bytes += info.size;
        if (bytes > budget.maxBytes) throw new Error(`发行包展开总大小超过安全上限（${Math.floor(budget.maxBytes / 1024 / 1024)} MB）`);
      } else {
        throw new Error('发行包包含不支持的文件类型');
      }
    }
  };

  walk(root, 0);
  return { entries, bytes };
}

/** Async counterpart for main-process callers so large archives do not block Electron's event loop. */
export async function enforceMediaRuntimeExpansionBudgetAsync(
  extractedRoot: string,
  filesystem: AsyncRuntimeTreeFilesystemPort,
  signal?: AbortSignal,
  budget: MediaRuntimeExpansionBudget = DEFAULT_MEDIA_RUNTIME_EXPANSION_BUDGET,
): Promise<{ entries: number; bytes: number }> {
  if ((await filesystem.lstat(extractedRoot)).isSymbolicLink()) throw new Error('发行包解压目录不能是符号链接或 Windows reparse point');
  const root = await filesystem.realpath(extractedRoot);
  let entries = 0;
  let bytes = 0;

  const walk = async (directory: string, depth: number): Promise<void> => {
    if (signal?.aborted) throw new Error('已取消下载');
    for (const entry of await filesystem.readdir(directory)) {
      if (signal?.aborted) throw new Error('已取消下载');
      entries += 1;
      if (entries > budget.maxEntries) throw new Error(`发行包展开条目超过安全上限（${budget.maxEntries}）`);
      const path = join(directory, entry.name);
      const info = await filesystem.lstat(path);
      if (entry.isSymbolicLink() || info.isSymbolicLink()) throw new Error('发行包展开目录包含符号链接或 Windows reparse point');
      const actual = await filesystem.realpath(path);
      if (!isPathWithin(root, actual)) throw new Error('发行包展开路径越出临时目录');
      const childDepth = depth + 1;
      if (childDepth > budget.maxDepth) throw new Error(`发行包目录深度超过安全上限（${budget.maxDepth}）`);
      if (info.isDirectory()) {
        await walk(actual, childDepth);
      } else if (info.isFile()) {
        if (!Number.isSafeInteger(info.size) || info.size < 0) throw new Error('发行包文件大小无效');
        bytes += info.size;
        if (bytes > budget.maxBytes) {
          throw new Error(`发行包展开总大小超过安全上限（${Math.floor(budget.maxBytes / 1024 / 1024)} MB）`);
        }
      } else {
        throw new Error('发行包包含不支持的文件类型');
      }
    }
  };

  await walk(root, 0);
  return { entries, bytes };
}

function isMissingPathError(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT';
}


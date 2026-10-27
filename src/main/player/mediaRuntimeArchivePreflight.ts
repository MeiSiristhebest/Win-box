import type { MediaRuntimeExpansionBudget } from './mediaRuntimePathSafety';
import { DEFAULT_MEDIA_RUNTIME_EXPANSION_BUDGET } from './mediaRuntimePathSafety';

/** Cap metadata emitted by `7zz l -slt` before sending it from the worker to the main process. */
export const MAX_MEDIA_RUNTIME_LISTING_BYTES = 64 * 1024 * 1024;

/**
 * Validate 7-Zip's technical listing before extraction starts. This is intentionally strict:
 * unknown or incomplete listing formats fail closed so `x` is never called without a budget check.
 */
export function validateMediaRuntimeArchiveListing(
  listing: string,
  budget: MediaRuntimeExpansionBudget = DEFAULT_MEDIA_RUNTIME_EXPANSION_BUDGET,
): { entries: number; bytes: number } {
  if (!listing || Buffer.byteLength(listing, 'utf8') > MAX_MEDIA_RUNTIME_LISTING_BYTES) {
    throw new Error('发行包目录清单为空或超过安全上限');
  }

  const separator = listing.indexOf('----------');
  if (separator < 0) throw new Error('无法识别发行包目录清单格式，已停止解压');
  const entriesText = listing.slice(separator + '----------'.length);
  let entries = 0;
  let bytes = 0;
  const records = entriesText.split(/\r?\n\s*\r?\n/);

  for (const rawRecord of records) {
    const record = rawRecord.trim();
    if (!record) continue;
    const fields = new Map<string, string>();
    for (const line of record.split(/\r?\n/)) {
      const separatorIndex = line.indexOf('=');
      if (separatorIndex < 1) throw new Error(`发行包目录清单字段不完整，已停止解压：${line.slice(0, 160)}`);
      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trimStart();
      if (!key) throw new Error('发行包目录清单字段名为空，已停止解压');
      if (fields.has(key)) throw new Error('发行包目录清单字段重复，已停止解压');
      fields.set(key, value);
    }

    const archivePath = fields.get('Path');
    if (archivePath === undefined) throw new Error('发行包目录清单缺少路径，已停止解压');
    validateArchiveEntryPath(archivePath, budget.maxDepth);
    if ([...fields.keys()].some((key) => /(?:symbolic|hard)?\s*link|reparse/i.test(key))) {
      throw new Error('发行包包含链接或 reparse 项，已停止解压');
    }
    const attributes = fields.get('Attributes') ?? '';
    if (/(?:^|\s)l[drwx-]{9}(?:$|\s)/i.test(attributes)) {
      throw new Error('发行包包含链接或 reparse 项，已停止解压');
    }

    entries += 1;
    if (entries > budget.maxEntries) throw new Error(`发行包展开条目超过安全上限（${budget.maxEntries}）`);
    const folder = fields.get('Folder');
    if (folder === '+') continue;
    if (folder !== undefined && folder !== '-') throw new Error('发行包目录项类型无法识别，已停止解压');
    const sizeText = fields.get('Size');
    if (!sizeText || !/^\d+$/.test(sizeText)) throw new Error('发行包文件大小字段无效，已停止解压');
    const size = Number(sizeText);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('发行包文件大小超出安全范围');
    bytes += size;
    if (bytes > budget.maxBytes) {
      throw new Error(`发行包展开总大小超过安全上限（${Math.floor(budget.maxBytes / 1024 / 1024)} MB）`);
    }
  }

  if (entries === 0) throw new Error('发行包目录清单没有可解压项目');
  return { entries, bytes };
}

function validateArchiveEntryPath(path: string, maxDepth: number): void {
  if (!path || path.includes('\0') || path.startsWith('/') || path.startsWith('\\') || /^[a-z]:/i.test(path)) {
    throw new Error(`发行包包含绝对路径，已停止解压：${path.slice(0, 120)}`);
  }
  const segments = path.split(/[\\/]/).filter((segment) => segment !== '' && segment !== '.');
  if (!segments.length || segments.some((segment) => segment === '..' || segment.includes(':'))) {
    throw new Error(`发行包包含越界或不安全路径，已停止解压：${path.slice(0, 120)}`);
  }
  if (segments.length > maxDepth) throw new Error(`发行包目录深度超过安全上限（${maxDepth}）`);
}

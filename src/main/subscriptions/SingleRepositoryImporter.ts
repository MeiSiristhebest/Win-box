import type { ImportReport, Logger, SiteConfig } from '../../shared/types';
import type { ParseResult } from '../../engine/config/ApiConfigParser';
import { isFetchedRepoUrl, pickRepoLine, repoDisplayName } from '../../engine/config/multiRepo';
import type { MultiRepo } from '../../engine/config/multiRepo';
import type { SubscriptionImportProgressPatch } from './SubscriptionImportService';

export interface SingleRepositoryImportOptions {
  multi: MultiRepo;
  snapshot: boolean;
  name: string;
  preferredLine: number;
  signal?: AbortSignal;
  expectedConfigRevision?: number;
  onProgress?: (patch: SubscriptionImportProgressPatch) => void;
}

export interface SingleRepositoryImportPorts {
  currentRevision(): number;
  fetchConfigWithDiagnostics(url: string, signal?: AbortSignal): Promise<{ text: string; hint: string }>;
  parse(text: string, baseUrl: string): ParseResult;
  setReport(report: ImportReport): void;
  setCurrentConfig(config: SiteConfig): void;
  applyConfig(config: SiteConfig): void;
  recordImportedConfig(config: SiteConfig, url: string, snapshot: boolean, name: string): void;
  logger: Pick<Logger, 'i'>;
}

/** Handles the explicit #line=N import flow without coupling it to the host's multi-repo lifecycle. */
export async function importSingleRepository(
  options: SingleRepositoryImportOptions,
  ports: SingleRepositoryImportPorts,
): Promise<ParseResult> {
  const { multi, snapshot, name, preferredLine, signal, expectedConfigRevision, onProgress } = options;
  const total = multi.items.length;
  if (signal?.aborted) throw signal.reason ?? new Error('导入已取消');
  if (expectedConfigRevision !== undefined && ports.currentRevision() !== expectedConfigRevision) {
    throw new Error('配置已在导入期间更改；多仓下载尚未开始，请重新导入');
  }

  onProgress?.({ state: 'running', total: 1, completed: 0, succeeded: 0, failed: 0, pending: 1 });
  const picked = pickRepoLine(multi.items, preferredLine)!;
  const label = repoDisplayName(picked.item.url, picked.item.name);
  const lineNo = picked.index + 1;
  const clampedNote = picked.index !== preferredLine ? `（#line=${preferredLine} 超出范围，共 ${total} 条，已取末条）` : '';
  if (!isFetchedRepoUrl(picked.item.url)) {
    const reason = /^clan:/i.test(picked.item.url) ? '本地目录仓（clan://）桌面版不可用' : '不支持的协议';
    throw new Error(`多仓第 ${lineNo} 条线路「${label}」不可用：${reason}${clampedNote}`);
  }

  try {
    const fetched = await ports.fetchConfigWithDiagnostics(picked.item.url, signal);
    if (signal?.aborted) throw signal.reason ?? new Error('导入已取消');
    const result = ports.parse(fetched.text, picked.item.url);
    if (!result.config.sites.length && !result.config.lives.length) throw new Error('内容为空/非订阅配置');
    if (expectedConfigRevision !== undefined && ports.currentRevision() !== expectedConfigRevision) {
      throw new Error('配置已在导入期间更改；本次结果未覆盖现有配置，请重新导入');
    }

    ports.setReport(result.report);
    ports.setCurrentConfig(result.config);
    ports.applyConfig(result.config);
    ports.recordImportedConfig(result.config, picked.item.url, snapshot, name);
    const note = `已按地址指定的 #line=${preferredLine} 导入多仓第 ${lineNo}/${total} 条线路「${label}」${clampedNote}${fetched.hint ? `｜诊断：${fetched.hint}` : ''}`;
    onProgress?.({ total: 1, completed: 1, succeeded: 1, failed: 0, pending: 0, currentName: label, message: note });
    ports.logger.i('multi-repo(line): ' + note);
    return { ...result, warnings: [...(result.warnings || []), note] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    onProgress?.(signal?.aborted
      ? { total: 1, completed: 0, succeeded: 0, failed: 0, pending: 1, currentName: label }
      : { total: 1, completed: 0, succeeded: 0, failed: 1, pending: 0, currentName: label });
    throw new Error(`多仓第 ${lineNo} 条线路（#line=${preferredLine}）「${label}」导入失败：${message}`);
  }
}

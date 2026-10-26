// L4 沙箱生命周期：把登记表中的插件身份映射到独立 worker 实例。
// 同步可以重入：替换/停用会立即使旧实例失效，不等待旧 start() 返回。

import type { Logger } from '../../../shared/types';
import type { PluginKind, PluginSandboxView } from '../../../shared/plugin';
import { PluginSandbox, type PluginSandboxOptions, type SandboxLike } from './PluginSandbox';
import type { PluginSandboxApi } from './protocol';

/** 与登记表对齐所需的最小条目描述（由 PluginHost 提供） */
export interface SandboxEntry {
  id: string;
  enabled: boolean;
  kind: PluginKind;
  payloadReady: boolean;
  /** 插件根目录（`<pluginsDir>/<id>.winbox`） */
  path: string;
  /** 沙箱入口（`manifest.main`；asset 恒 undefined） */
  main?: string;
  /** 声明版本；同版本载荷仍由 contentFingerprint 区分 */
  version?: string;
  /** 入口文件内容摘要，用于检测原地覆盖的同版本插件 */
  contentFingerprint?: string;
  permissions: string[];
}

export interface PluginSandboxLifecycleOptions {
  api: PluginSandboxApi;
  workerFile: string;
  logger: Logger;
  /** 沙箱工厂（可注入假件，便于单测；缺省 new PluginSandbox） */
  factory?: (opts: PluginSandboxOptions) => SandboxLike;
}

interface SandboxRecord {
  identity: string;
  permissions: string[];
  box: SandboxLike;
  startPromise: Promise<void>;
  invalidated: Promise<void>;
  invalidate: () => void;
  disposed: boolean;
  startedSuccessfully: boolean;
}

interface StartupFailure {
  identity: string;
  error: string;
}

export class PluginSandboxLifecycle {
  private readonly boxes = new Map<string, SandboxRecord>();
  private readonly failures = new Map<string, StartupFailure>();

  constructor(private readonly opts: PluginSandboxLifecycleOptions) {}

  /** 与登记表对齐；同一插件身份共享启动任务，身份变化会立即撤销旧代次。 */
  async sync(entries: SandboxEntry[]): Promise<void> {
    const desired = new Map<string, { entry: SandboxEntry; identity: string }>();
    for (const entry of entries) {
      if (!(entry.enabled && entry.kind === 'code' && entry.payloadReady && !!entry.main)) continue;
      desired.set(entry.id, { entry, identity: identityOf(entry) });
    }

    // 先撤销旧记录，再创建新记录。这样停用/卸载不会等到一个悬挂中的 start()。
    for (const [id, record] of this.boxes) {
      const next = desired.get(id);
      const crashed = record.startedSuccessfully && !record.box.running;
      if (next && next.identity === record.identity && !crashed) continue;
      this.boxes.delete(id);
      this.retire(record);
    }

    // 失败状态只属于同一身份；插件更新或停用后不保留旧错误。
    for (const [id, failure] of this.failures) {
      const next = desired.get(id);
      if (!next || next.identity !== failure.identity) this.failures.delete(id);
    }

    const pending: Promise<void>[] = [];
    for (const [id, item] of desired) {
      let record = this.boxes.get(id);
      if (!record) {
        this.failures.delete(id);
        try {
          record = this.createRecord(item.entry, item.identity);
        } catch (error) {
          const message = errorMessage(error);
          this.failures.set(id, { identity: item.identity, error: message });
          this.opts.logger.e(`插件沙箱创建异常（${id}）`, error);
          continue;
        }
      }
      pending.push(Promise.race([record.startPromise, record.invalidated]));
    }

    await Promise.all(pending);
  }

  /** 某插件的沙箱运行态（无沙箱且无启动失败 → undefined） */
  stateOf(id: string): PluginSandboxView | undefined {
    const record = this.boxes.get(id);
    if (record) return { running: record.box.running, error: record.box.error };
    const failure = this.failures.get(id);
    return failure ? { running: false, error: failure.error } : undefined;
  }

  disposeAll(): void {
    for (const [id, record] of this.boxes) {
      this.boxes.delete(id);
      this.retire(record);
    }
    this.failures.clear();
  }

  private createRecord(entry: SandboxEntry, identity: string): SandboxRecord {
    const box = this.create(entry);
    let invalidate!: () => void;
    const invalidated = new Promise<void>((resolve) => {
      invalidate = resolve;
    });
    const record: SandboxRecord = {
      identity,
      permissions: [...entry.permissions],
      box,
      startPromise: Promise.resolve(),
      invalidated,
      invalidate,
      disposed: false,
      startedSuccessfully: false,
    };
    this.boxes.set(entry.id, record);
    record.startPromise = this.start(entry.id, record);
    return record;
  }

  private async start(id: string, record: SandboxRecord): Promise<void> {
    try {
      const result = await record.box.start();
      if (!this.isCurrent(id, record)) return;
      if (!result.ok) {
        this.fail(id, record, result.error || record.box.error || '沙箱启动失败');
        return;
      }
      record.startedSuccessfully = true;
      this.failures.delete(id);
      this.opts.logger.i(`插件沙箱已启动：${id}（权限 ${record.permissions.join(',') || '-'}）`);
    } catch (error) {
      if (!this.isCurrent(id, record)) return;
      this.fail(id, record, errorMessage(error), error);
    }
  }

  private fail(id: string, record: SandboxRecord, message: string, cause?: unknown): void {
    if (!this.isCurrent(id, record)) return;
    this.boxes.delete(id);
    this.failures.set(id, { identity: record.identity, error: message });
    if (cause === undefined) this.opts.logger.w(`插件沙箱启动失败（${id}）：${message}`);
    else this.opts.logger.e(`插件沙箱启动异常（${id}）`, cause);
    this.retire(record);
  }

  private retire(record: SandboxRecord): void {
    if (record.disposed) return;
    record.disposed = true;
    // 让正等待此代次的 sync 立即完成；旧 start Promise 之后只会被忽略。
    record.invalidate();
    try {
      record.box.dispose();
    } catch (error) {
      this.opts.logger.e('释放插件沙箱失败', error);
    }
  }

  private isCurrent(id: string, record: SandboxRecord): boolean {
    return !record.disposed && this.boxes.get(id) === record;
  }

  private create(entry: SandboxEntry): SandboxLike {
    const options: PluginSandboxOptions = {
      pluginId: entry.id,
      pluginDir: entry.path,
      mainFile: entry.main as string,
      permissions: entry.permissions as PluginSandboxOptions['permissions'],
      api: this.opts.api,
      workerFile: this.opts.workerFile,
      logger: this.opts.logger,
    };
    return this.opts.factory ? this.opts.factory(options) : new PluginSandbox(options);
  }
}

function identityOf(entry: SandboxEntry): string {
  return JSON.stringify({
    path: entry.path,
    version: entry.version ?? '',
    main: entry.main ?? '',
    permissions: [...new Set(entry.permissions)].sort(),
    contentFingerprint: entry.contentFingerprint ?? '',
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

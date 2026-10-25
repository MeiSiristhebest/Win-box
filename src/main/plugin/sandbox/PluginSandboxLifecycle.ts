// src/main/plugin/sandbox/PluginSandboxLifecycle.ts
// L4 沙箱的**生命周期管理**：与插件登记表对齐 ——
//   启用 + `kind:"code"` + 载荷就位 → 确保沙箱在跑；否则（停用 / 卸载 / 载荷未就位）→ 释放。
//
// ★ 与宿主登记表**幂等对齐**（`sync` 可反复调用）：只有「该跑但没跑」才 start，
//   只有「不该跑但还在跑」才 dispose；避免每次 install/启停都重建 worker。
//
// 事实源：docs/spec/R10-l4-sandbox-api/spec.md §6.3。

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
  permissions: string[];
}

export interface PluginSandboxLifecycleOptions {
  api: PluginSandboxApi;
  workerFile: string;
  logger: Logger;
  /** 沙箱工厂（可注入假件，便于单测；缺省 new PluginSandbox） */
  factory?: (opts: PluginSandboxOptions) => SandboxLike;
}

export class PluginSandboxLifecycle {
  private readonly boxes = new Map<string, SandboxLike>();

  constructor(private readonly opts: PluginSandboxLifecycleOptions) {}

  /** 与登记表对齐（幂等）：该跑的在跑、不该跑的释放 */
  async sync(entries: SandboxEntry[]): Promise<void> {
    const want = new Set<string>();
    for (const e of entries) {
      if (!(e.enabled && e.kind === 'code' && e.payloadReady && !!e.main)) continue;
      want.add(e.id);
      if (this.boxes.has(e.id)) continue;
      const box = this.create(e);
      this.boxes.set(e.id, box);
      try {
        const r = await box.start();
        if (r.ok) this.opts.logger.i(`插件沙箱已启动：${e.id}（权限 ${e.permissions.join(',') || '-'}）`);
        else this.opts.logger.w(`插件沙箱启动失败（${e.id}）：${r.error}`);
      } catch (err) {
        this.opts.logger.e(`插件沙箱启动异常（${e.id}）`, err);
      }
    }
    for (const [id, box] of this.boxes) {
      if (want.has(id)) continue;
      box.dispose();
      this.boxes.delete(id);
    }
  }

  /** 某插件的沙箱运行态（无沙箱 → undefined） */
  stateOf(id: string): PluginSandboxView | undefined {
    const box = this.boxes.get(id);
    return box ? { running: box.running, error: box.error } : undefined;
  }

  disposeAll(): void {
    for (const box of this.boxes.values()) box.dispose();
    this.boxes.clear();
  }

  private create(e: SandboxEntry): SandboxLike {
    const o: PluginSandboxOptions = {
      pluginId: e.id,
      pluginDir: e.path,
      mainFile: e.main as string,
      permissions: e.permissions as PluginSandboxOptions['permissions'],
      api: this.opts.api,
      workerFile: this.opts.workerFile,
      logger: this.opts.logger,
    };
    return this.opts.factory ? this.opts.factory(o) : new PluginSandbox(o);
  }
}

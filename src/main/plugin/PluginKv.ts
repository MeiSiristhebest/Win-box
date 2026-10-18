// src/main/plugin/PluginKv.ts
// L4 沙箱的**命名空间隔离** KV（规范 §6.1 `kv`）：底层复用宿主 `JsonStore`
// （`<userData>/plugin-kv.json`），键统一加前缀 `plugin:<id>:` —— **前缀由宿主拼接**，
// 插件侧只见到自己的裸 key（两个插件用同名 key **不串**）。
//
// 事实源：docs/design/插件制作规范.md §6.1；docs/spec/R10-l4-sandbox-api/spec.md §5.2。

import { JsonStore } from '../store/JsonStore';

export class PluginKv {
  constructor(private readonly store: JsonStore) {}

  private full(pluginId: string, key: string): string {
    return `plugin:${pluginId}:${key}`;
  }

  get(pluginId: string, key: string): string {
    return this.store.get(this.full(pluginId, key));
  }

  set(pluginId: string, key: string, val: string): void {
    this.store.set(this.full(pluginId, key), val);
  }

  delete(pluginId: string, key: string): void {
    this.store.delete(this.full(pluginId, key));
  }

  flush(): void {
    this.store.flush();
  }
}

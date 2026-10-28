import type { EngineHost } from '../../engine/ports';
import { Spider, type SpiderInit } from '../../engine/spider/Spider';
import type { SpiderRuntimeProvider } from '../../engine/spider/SpiderRuntimeProvider';
import type { SourceBean } from '../../shared/types';
import { boundedJsonClone, type SpiderRuntimeOperation, type SpiderRuntimeContribute } from '../../shared/plugin';

export interface ActiveSpiderRuntimeContribute extends SpiderRuntimeContribute {
  pluginId: string;
}

export interface PluginSpiderRuntimeProviderPorts {
  list(): readonly ActiveSpiderRuntimeContribute[];
  invoke(
    pluginId: string,
    providerId: string,
    operation: SpiderRuntimeOperation,
    input: unknown,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<unknown>;
}

/** Main-process adapter that exposes only installed, enabled, permissioned Spider contributors. */
export class PluginSpiderRuntimeProvider implements SpiderRuntimeProvider<EngineHost> {
  constructor(private readonly ports: PluginSpiderRuntimeProviderPorts) {}

  supports(source: SourceBean): boolean {
    return this.matching(source).length > 0;
  }

  create(source: SourceBean, init: SpiderInit<EngineHost>): Spider {
    if (!this.supports(source)) throw new Error('没有已启用的插件 Spider provider 匹配该源');
    return new PluginBackedSpider(init, source, this.ports);
  }

  private matching(source: SourceBean): ActiveSpiderRuntimeContribute[] {
    const api = typeof source.api === 'string' ? source.api : '';
    return this.ports.list().filter((item) => api.startsWith(item.apiPrefix));
  }
}

class PluginBackedSpider extends Spider {
  private readonly source: SourceBean;
  private readonly ports: PluginSpiderRuntimeProviderPorts;
  private readonly calls = new Set<AbortController>();

  constructor(init: SpiderInit<EngineHost>, source: SourceBean, ports: PluginSpiderRuntimeProviderPorts) {
    super(init);
    this.source = { ...source };
    this.ports = ports;

    const homeContent = (filter: boolean, signal?: AbortSignal): Promise<string> => this.invoke('homeContent', { filter }, signal);
    const homeVideoContent = (signal?: AbortSignal): Promise<string> => this.invoke('homeVideoContent', {}, signal);
    const categoryContent = (tid: string, pg: string, filter: boolean, extend: Record<string, string>, signal?: AbortSignal): Promise<string> =>
      this.invoke('categoryContent', { tid, pg, filter, extend }, signal);
    const detailContent = (ids: string[]): Promise<string> => this.invoke('detailContent', { ids });
    const searchContent = (key: string, quick: boolean, timeoutMs?: number, signal?: AbortSignal): Promise<string> =>
      this.invoke('searchContent', { key, quick }, signal, timeoutMs);
    const searchContentPage = (key: string, quick: boolean, pg: string, timeoutMs?: number, signal?: AbortSignal): Promise<string> =>
      this.invoke('searchContentPage', { key, quick, pg }, signal, timeoutMs);
    const playerContent = (flag: string, id: string, vipFlags: string[]): Promise<string> =>
      this.invoke('playerContent', { flag, id, vipFlags });
    const liveContent = (url: string): Promise<string> => this.invoke('liveContent', { url });

    this.bindCapability('homeContent', homeContent);
    this.bindCapability('homeVideoContent', homeVideoContent);
    this.bindCapability('categoryContent', categoryContent);
    this.bindCapability('detailContent', detailContent);
    this.bindCapability('searchContent', searchContent);
    this.bindCapability('searchContentPage', searchContentPage);
    this.bindCapability('playerContent', playerContent);
    this.bindCapability('liveContent', liveContent);
  }

  private bindCapability(operation: SpiderRuntimeOperation, implementation: (...args: never[]) => unknown): void {
    Object.defineProperty(this, operation, {
      configurable: false,
      enumerable: false,
      get: () => this.providersFor(operation).length ? implementation : Spider.prototype[operation],
    });
  }

  private providersFor(operation: SpiderRuntimeOperation): ActiveSpiderRuntimeContribute[] {
    const api = typeof this.source.api === 'string' ? this.source.api : '';
    return this.ports.list().filter((item) => api.startsWith(item.apiPrefix) && item.operations.includes(operation));
  }

  private async invoke(
    operation: SpiderRuntimeOperation,
    args: Record<string, unknown>,
    signal?: AbortSignal,
    timeoutMs?: number,
  ): Promise<string> {
    const provider = this.providersFor(operation)[0];
    if (!provider) throw new Error(`没有已启用的插件 Spider provider 支持操作：${operation}`);
    const controller = new AbortController();
    const onAbort = (): void => controller.abort(signal?.reason);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    this.calls.add(controller);
    try {
      const input = boundedJsonClone({
        source: {
          key: this.siteKey,
          api: this.source.api,
          ext: this.source.ext || '',
          jar: this.source.jar || '',
        },
        args,
      }, 256 * 1024);
      const result = await this.ports.invoke(provider.pluginId, provider.id, operation, input, timeoutMs || this.timeoutMs, controller.signal);
      if (typeof result !== 'string') throw new Error(`Spider ${operation} 必须返回 JSON 字符串`);
      return result;
    } catch (error) {
      if (controller.signal.aborted) {
        const canceled = new Error(controller.signal.reason instanceof Error ? controller.signal.reason.message : 'Spider call aborted');
        canceled.name = 'AbortError';
        throw canceled;
      }
      throw error;
    } finally {
      signal?.removeEventListener('abort', onAbort);
      this.calls.delete(controller);
    }
  }

  cancelByTag(): void {
    for (const controller of this.calls) controller.abort(new Error('Spider calls canceled'));
    this.calls.clear();
  }

  destroy(): void {
    this.cancelByTag();
  }
}

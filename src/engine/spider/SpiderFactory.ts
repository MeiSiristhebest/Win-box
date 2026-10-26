// src/engine/spider/SpiderFactory.ts
// Runtime source creation replaces Android's getCSP二次分发（ApiConfig.java:1456）。
// 注意：type 0/1/4 不走此工厂（由 CmsSource 处理）。
import type { SourceBean } from '../../shared/types';
import type { EngineHost } from '../ports';
import { Spider, type SpiderInit } from './Spider';
import { sourceTimeoutMs } from './sourceTimeout';
export { sourceTimeoutMs } from './sourceTimeout';
import { SpiderNull } from './SpiderNull';
import { UnsupportedSpider } from './UnsupportedSpider';
import { SpiderCache, type SpiderCacheOptions } from './SpiderCache';
import type { JarSpiderRuntimePort } from './JarSpiderPorts';
import type { SpiderFactoryPort } from './SpiderFactoryPort';
import { createBuiltinSpiderRuntimeProviders } from './createBuiltinSpiderRuntimeProviders';
import type { SpiderRuntimeProvider } from './SpiderRuntimeProvider';
import type { PythonSpiderScriptPort } from './PythonSpiderScriptPort';
import type { PythonSpiderRuntimePort } from './PythonSpiderRuntimePort';


export interface SpiderFactoryOptions {
  /** JVM-backed spider capability; absent runtimes degrade to a typed unsupported adapter. */
  jarRuntime?: JarSpiderRuntimePort;
  /** Python execution capability, separate from JVM archive conversion. */
  pythonRuntime?: PythonSpiderRuntimePort;
  /** Main-process port for Python script resolution, download, and cache I/O. */
  pythonScripts?: PythonSpiderScriptPort;
  /** Ordered protocol extensions. They take precedence over built-in source runtimes. */
  runtimeProviders?: readonly SpiderRuntimeProvider<EngineHost>[];
  /** Reports best-effort adapter teardown failures without blocking configuration changes. */
  onDisposeError?: (error: unknown, spider: Spider) => void;
  /** Per-process source adapter retention budget; production defaults to 64 entries / 10 minutes. */
  cacheOptions?: SpiderCacheOptions;
}

export class SpiderFactory implements SpiderFactoryPort<EngineHost> {
  private readonly cache: SpiderCache;
  private readonly runtimeProviders: readonly SpiderRuntimeProvider<EngineHost>[];

  constructor(opts: SpiderFactoryOptions = {}) {
    this.cache = new SpiderCache(opts.onDisposeError, opts.cacheOptions);
    this.runtimeProviders = [
      ...(opts.runtimeProviders ?? []),
      ...createBuiltinSpiderRuntimeProviders({
        jarRuntime: opts.jarRuntime,
        pythonRuntime: opts.pythonRuntime,
        pythonScripts: opts.pythonScripts,
      }),
    ];
  }

  /**
   * 缓存键 = 执行命名空间 + 影响蜘蛛行为的字段签名（api/ext/jar）。
   * ★ 修复"ext 模块缺陷"：同 key 下改 ext（含网盘绑定参数）必须新建蜘蛛实例，
   *   否则蜘蛛 init(Context, ext) 一直拿旧 ext → 表现为配置了也不生效。
   */
  private keyOf(bean: SourceBean): string {
    const sig = [bean.api, bean.ext, bean.jar].map((s) => String(s || '').length + ':' + String(s || '')).join('|');
    return `${bean.runtimeScope || bean.key}::${sig}`;
  }

  /** Creates and caches the runtime adapter selected for a type=3 source. */
  createForSource(bean: SourceBean, host: EngineHost): Spider {
    return this.cache.getOrPut(this.keyOf(bean), () => {
      const init: SpiderInit<EngineHost> = {
        key: bean.runtimeScope || bean.key,
        api: bean.api,
        ext: bean.ext,
        jar: bean.jar,
        host,
        // ★ 源声明 timeout（秒，0 → 默认）→ 子进程调用超时；与聚合搜索单源超时同源，
        //   使「蜘蛛卡住」最迟在源声明时间内被 kill（此前池内固定 120s → 表现为「搜半天没结果」）
        timeoutMs: sourceTimeoutMs(bean),
      };
      const provider = this.runtimeProviders.find((candidate) => candidate.supports(bean));
      if (provider) return provider.create(bean, init);
      return new UnsupportedSpider(init, 'UNSUPPORTED_FORMAT', '没有已注册的运行时可以处理该蜘蛛源');
    });
  }

  /** type=2 / 未知 → SpiderNull（与安卓一致：无分发分支） */
  getNull(bean: SourceBean, host: EngineHost): Spider {
    return this.cache.getOrPut(this.keyOf(bean), () => new SpiderNull({ key: bean.runtimeScope || bean.key, api: bean.api, ext: bean.ext, jar: bean.jar, host }));
  }

  clear(): void {
    this.cache.clear();
  }
}

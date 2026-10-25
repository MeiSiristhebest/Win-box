import { join } from 'node:path';
import type { EngineHost } from '../../engine/ports';
import { createPooledSandboxFactory } from '../../engine/js/worker/JsWorkerPool';
import { JarSpiderBridge } from '../../engine/spider/JarSpiderBridge';
import { PythonSpiderScriptAdapter } from './PythonSpiderScriptAdapter';
import { SpiderFactory } from '../../engine/spider/SpiderFactory';
import type { HttpClient, KVStore, Logger } from '../../shared/types';
import { childProxyEnv, getProxySettings, jvmProxyArgs } from '../net/proxy';

export interface SpiderRuntimeAssembly {
  host: EngineHost;
  bridge: JarSpiderBridge;
  spiders: SpiderFactory;
}

export interface SpiderRuntimeAssemblyOptions {
  http: HttpClient;
  kv: KVStore;
  logger: Logger;
  driveTokens: () => Record<string, string>;
  resourcesDirectory: string;
  cacheDirectory: string;
  spiderCacheDirectory: string;
  workerBundlePath: string;
}

/**
 * Main-process composition root for the JS, JVM, and source runtime adapters.
 * Runtime consumers receive the EngineHost capability contract; file paths,
 * proxy configuration, worker creation, and concrete bridges stay here.
 */
export function createSpiderRuntimeAssembly(options: SpiderRuntimeAssemblyOptions): SpiderRuntimeAssembly {
  const host: EngineHost = {
    http: options.http,
    kv: options.kv,
    logger: options.logger,
    jsLibDir: join(options.resourcesDirectory, 'js-lib'),
    driveTokens: options.driveTokens,
  };

  host.jsSandboxFactory = createPooledSandboxFactory(host, options.workerBundlePath);

  const bridge = new JarSpiderBridge(
    {
      jvmDir: join(options.resourcesDirectory, 'jvm'),
      cacheDir: join(options.spiderCacheDirectory, 'converted'),
      callTimeoutMs: 20000,
      pyRuntimeDir: join(options.cacheDirectory, 'python'),
      nativeRuntimeDir: join(options.cacheDirectory, 'native'),
      proxyProvider: () => {
        const settings = getProxySettings();
        return { jvmArgs: jvmProxyArgs(settings), env: childProxyEnv(settings) };
      },
    },
    host,
  );

  const pythonScripts = new PythonSpiderScriptAdapter({
    cacheDirectory: join(options.spiderCacheDirectory, 'py'),
    http: options.http,
  });

  return {
    host,
    bridge,
    spiders: new SpiderFactory({
      jarRuntime: bridge,
      pythonRuntime: bridge,
      pythonScripts,
      onDisposeError: (error, spider) => options.logger.e(`蜘蛛 ${spider.siteKey} 释放失败`, error),
    }),
  };
}

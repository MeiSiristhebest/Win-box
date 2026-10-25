import type { SourceBean } from '../../shared/types';
import type { EngineHost } from '../ports';
import { JarSpider } from './JarSpider';
import type { JarSpiderRuntimePort } from './JarSpiderPorts';
import { PySpider } from './PySpider';
import type { SpiderInit } from './Spider';
import type { SpiderRuntimeProvider } from './SpiderRuntimeProvider';
import { UnsupportedSpider } from './UnsupportedSpider';
import { JsSpider } from '../js/JsSpider';
import type { PythonSpiderRuntimePort } from './PythonSpiderRuntimePort';
import type { PythonSpiderScriptPort } from './PythonSpiderScriptPort';

export interface BuiltinSpiderRuntimeDependencies {
  jarRuntime?: JarSpiderRuntimePort;
  pythonRuntime?: PythonSpiderRuntimePort;
  pythonScripts?: PythonSpiderScriptPort;
}

function normalizedApi(source: SourceBean): string {
  return String(source.api ?? '').toLowerCase();
}

function isJavaScriptSource(source: SourceBean): boolean {
  const api = normalizedApi(source);
  return api.endsWith('.js') || api.includes('.js?');
}

function isPythonSource(source: SourceBean): boolean {
  return normalizedApi(source).includes('.py');
}

function javascriptProvider(): SpiderRuntimeProvider<EngineHost> {
  return {
    supports: isJavaScriptSource,
    create: (_source: SourceBean, init: SpiderInit<EngineHost>) => new JsSpider(init),
  };
}

function pythonProvider(runtime: PythonSpiderRuntimePort | undefined, scripts: PythonSpiderScriptPort | undefined): SpiderRuntimeProvider<EngineHost> {
  return {
    supports: isPythonSource,
    create: (_source: SourceBean, init: SpiderInit<EngineHost>) => {
      if (!runtime) return new UnsupportedSpider(init, 'UNSUPPORTED_PY', 'python spider 需要配置运行时');
      if (!scripts) return new UnsupportedSpider(init, 'UNSUPPORTED_PY', 'python spider 脚本加载适配器未配置');
      return new PySpider(init, runtime, scripts);
    },
  };
}

function jarProvider(runtime: JarSpiderRuntimePort | undefined): SpiderRuntimeProvider<EngineHost> {
  return {
    // The upstream source format uses csp_* identifiers as well as jar URLs.
    // Keep the historical fallback behavior for every non-JS/non-Python API.
    supports: () => true,
    create: (_source: SourceBean, init: SpiderInit<EngineHost>) => runtime
      ? new JarSpider(init, runtime)
      : new UnsupportedSpider(init, 'UNSUPPORTED_JAR', 'jar(dex) spider 需要 JVM 运行时（runtime 未配置）'),
  };
}

/** Built-in protocols in precedence order; extension providers are prepended by SpiderFactory. */
export function createBuiltinSpiderRuntimeProviders(dependencies: BuiltinSpiderRuntimeDependencies = {}): readonly SpiderRuntimeProvider<EngineHost>[] {
  return [
    javascriptProvider(),
    pythonProvider(dependencies.pythonRuntime, dependencies.pythonScripts),
    jarProvider(dependencies.jarRuntime),
  ];
}

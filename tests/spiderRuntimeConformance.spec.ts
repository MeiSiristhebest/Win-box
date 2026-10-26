import { describe, expect, it } from 'vitest';
import type { EngineHost } from '../src/engine/ports';
import { JsSpider } from '../src/engine/js/JsSpider';
import type { JsSpiderRuntimePort } from '../src/engine/js/JsSandboxPort';
import { JarSpider } from '../src/engine/spider/JarSpider';
import type { JarSpiderRuntimePort } from '../src/engine/spider/JarSpiderPorts';
import { PySpider } from '../src/engine/spider/PySpider';
import type { PythonSpiderRuntimePort } from '../src/engine/spider/PythonSpiderRuntimePort';
import type { PythonSpiderScriptPort } from '../src/engine/spider/PythonSpiderScriptPort';
import { SourceProblemError, type SourceProblemCode } from '../src/engine/spider/errors';
import { spiderCallFailed, spiderCallSucceeded, type SpiderCallResult } from '../src/engine/spider/spiderCallResult';
import type { Spider } from '../src/engine/spider/Spider';
import { awaitWithAbort } from '../src/engine/util/abort';

type RuntimeCase = {
  name: string;
  result: SpiderCallResult;
  expectedCode?: SourceProblemCode;
  expectedMessage?: string;
  runtimeError?: Error;
};

type RuntimeHarness = {
  name: string;
  spider: Spider;
  preparationCalls: () => number;
  invocationCalls: () => number;
};

const cases: RuntimeCase[] = [
  { name: 'legal empty output', result: spiderCallSucceeded('') },
  {
    name: 'unsupported operation',
    result: spiderCallFailed('', '该源未提供搜索功能', null, 'OPERATION_UNSUPPORTED'),
    expectedCode: 'OPERATION_UNSUPPORTED',
    expectedMessage: '该源未提供搜索功能',
  },
  {
    name: 'execution failure',
    result: spiderCallFailed('', '蜘蛛执行失败', null, 'SPIDER_ERROR'),
    expectedCode: 'SPIDER_ERROR',
    expectedMessage: '蜘蛛执行失败',
  },
  {
    name: 'timeout',
    result: spiderCallFailed('', '蜘蛛调用超时', null, 'SPIDER_TIMEOUT'),
    expectedCode: 'SPIDER_TIMEOUT',
    expectedMessage: '蜘蛛调用超时',
  },
  {
    name: 'untyped runtime rejection',
    result: spiderCallSucceeded('unused'),
    runtimeError: new Error('bridge transport failed'),
    expectedCode: 'SPIDER_ERROR',
    expectedMessage: 'bridge transport failed',
  },
];

function makeHost(jsSandboxFactory?: EngineHost['jsSandboxFactory']): EngineHost {
  return {
    http: {
      request: async (request) => ({ status: 200, headers: {}, content: '', finalUrl: request.url }),
    },
    kv: { get: () => '', set: () => undefined, delete: () => undefined },
    logger: { i: () => undefined, w: () => undefined, e: () => undefined },
    jsSandboxFactory,
  };
}

function resultToJsValue(result: SpiderCallResult): string {
  if (result.ok) return result.output;
  throw new SourceProblemError(result.problemCode, result.reason);
}

function makeJsHarness(result: SpiderCallResult, runtimeError?: Error, preparationError?: Error, preparationBarrier?: Promise<void>): RuntimeHarness {
  let preparationCalls = 0;
  let invocationCalls = 0;
  const runtime: JsSpiderRuntimePort = {
    siteKey: 'js-source',
    spiderStyle: 'unknown',
    setExt: () => undefined,
    ensureLoaded: async (signal) => {
      preparationCalls += 1;
      if (preparationBarrier) await awaitWithAbort(preparationBarrier, signal);
      if (preparationError) throw preparationError;
    },
    callMethod: async () => {
      invocationCalls += 1;
      if (runtimeError) throw runtimeError;
      return resultToJsValue(result);
    },
    destroy: () => undefined,
  };
  const host = makeHost(() => runtime);
  const spider = new JsSpider({ key: 'js-source', api: 'https://source.test/spider.js', ext: '', jar: '', host });
  return { name: 'JS', spider, preparationCalls: () => preparationCalls, invocationCalls: () => invocationCalls };
}

function makePythonHarness(result: SpiderCallResult, runtimeError?: Error, preparationError?: Error, preparationBarrier?: Promise<void>): RuntimeHarness {
  let preparationCalls = 0;
  let invocationCalls = 0;
  const runtime: PythonSpiderRuntimePort = {
    pyRuntimeReady: () => true,
    prewarmPythonRuntime: async () => 'C:/runtime',
    prewarmPython: () => 0,
    callPython: async () => {
      invocationCalls += 1;
      if (runtimeError) throw runtimeError;
      return result;
    },
  };
  const scripts: PythonSpiderScriptPort = {
    status: () => ({ path: 'C:/cache/source.py', available: true }),
    load: async () => {
      preparationCalls += 1;
      if (preparationBarrier) await preparationBarrier;
      if (preparationError) throw preparationError;
      return { status: 'ready', path: 'C:/cache/source.py' };
    },
  };
  const spider = new PySpider({
    key: 'python-source', api: 'https://source.test/spider.py', ext: '', jar: '', host: makeHost(),
  }, runtime, scripts);
  return { name: 'Python', spider, preparationCalls: () => preparationCalls, invocationCalls: () => invocationCalls };
}

function makeJarHarness(result: SpiderCallResult, runtimeError?: Error, preparationError?: Error, preparationBarrier?: Promise<void>): RuntimeHarness {
  let preparationCalls = 0;
  let invocationCalls = 0;
  const runtime: JarSpiderRuntimePort = {
    defaultJar: 'https://source.test/spider.jar',
    ensureConverted: async () => {
      preparationCalls += 1;
      if (preparationBarrier) await preparationBarrier;
      if (preparationError) throw preparationError;
      return 'C:/cache/spider.jar';
    },
    conversionProgress: () => null,
    resolvePaths: () => ['C:/cache/spider.jar'],
    peekConverted: () => 'C:/cache/spider.jar',
    prewarmJar: () => 0,
    pendingConvert: () => null,
    conversionFailure: () => '',
    warmup: async () => undefined,
    call: async () => {
      invocationCalls += 1;
      if (runtimeError) throw runtimeError;
      return result;
    },
    proxyPortForTag: () => null,
  };
  const spider = new JarSpider({
    key: 'jar-source', api: 'csp_Test', ext: '', jar: '', host: makeHost(),
  }, runtime);
  return { name: 'JVM', spider, preparationCalls: () => preparationCalls, invocationCalls: () => invocationCalls };
}

function makeJarCacheMissHarness(rebuildBarrier: Promise<void>, onRebuildStart: () => void): RuntimeHarness {
  let preparationCalls = 0;
  let invocationCalls = 0;
  let pathResolutions = 0;
  const runtime: JarSpiderRuntimePort = {
    defaultJar: 'https://source.test/spider.jar',
    ensureConverted: async () => {
      preparationCalls += 1;
      if (preparationCalls === 2) {
        onRebuildStart();
        await rebuildBarrier;
      }
      return 'C:/cache/spider.jar';
    },
    conversionProgress: () => null,
    resolvePaths: () => {
      pathResolutions += 1;
      return pathResolutions === 1 ? [] : ['C:/cache/spider.jar'];
    },
    peekConverted: () => 'C:/cache/spider.jar',
    prewarmJar: () => 0,
    pendingConvert: () => null,
    conversionFailure: () => '',
    warmup: async () => undefined,
    call: async () => {
      invocationCalls += 1;
      return spiderCallSucceeded('too late');
    },
    proxyPortForTag: () => null,
  };
  const spider = new JarSpider({
    key: 'jar-source', api: 'csp_Test', ext: '', jar: '', host: makeHost(),
  }, runtime);
  return { name: 'JVM', spider, preparationCalls: () => preparationCalls, invocationCalls: () => invocationCalls };
}

function makeRuntimes(
  result: SpiderCallResult,
  runtimeError?: Error,
  preparationError?: Error,
  preparationBarrier?: Promise<void>,
): RuntimeHarness[] {
  return [
    makeJsHarness(result, runtimeError, preparationError, preparationBarrier),
    makePythonHarness(result, runtimeError, preparationError, preparationBarrier),
    makeJarHarness(result, runtimeError, preparationError, preparationBarrier),
  ];
}

describe('Spider runtime replacement contract', () => {
  it.each(cases)('exposes $name consistently from JS, Python, and JVM spiders', async ({ result, expectedCode, expectedMessage, runtimeError }) => {
    for (const { name, spider } of makeRuntimes(result, runtimeError)) {
      const call = spider.searchContent('query', false, 750);
      if (expectedCode) {
        await expect(call, `${name} should preserve the typed failure`).rejects.toMatchObject({
          code: expectedCode,
          message: expectedMessage,
        });
      } else {
        await expect(call, `${name} should preserve a legal empty result`).resolves.toBe('');
      }
    }
  });

  it('does not prepare or execute any runtime when a search is already cancelled', async () => {
    for (const { name, spider, preparationCalls, invocationCalls } of makeRuntimes(spiderCallSucceeded('late'))) {
      const controller = new AbortController();
      controller.abort(new Error('search cancelled'));

      await expect(spider.searchContent('query', false, 750, controller.signal))
        .rejects.toMatchObject({ name: 'AbortError', message: 'search cancelled' });
      expect(preparationCalls(), `${name} preparation`).toBe(0);
      expect(invocationCalls(), `${name} invocation`).toBe(0);
    }
  });

  it('cancels in-flight preparation consistently without invoking a runtime', async () => {
    const preparation = Promise.withResolvers<void>();
    for (const { name, spider, preparationCalls, invocationCalls } of makeRuntimes(
      spiderCallSucceeded('too late'),
      undefined,
      undefined,
      preparation.promise,
    )) {
      const controller = new AbortController();
      const call = spider.searchContent('query', false, 750, controller.signal);
      controller.abort(new Error('search cancelled during preparation'));

      await expect(call, `${name} preparation cancellation`).rejects.toMatchObject({
        name: 'AbortError', message: 'search cancelled during preparation',
      });
      expect(preparationCalls(), `${name} preparation`).toBe(1);
      expect(invocationCalls(), `${name} invocation`).toBe(0);
    }
    preparation.resolve();
    await preparation.promise;
  });

  it('cancels promptly while rebuilding a missing JVM cache path', async () => {
    const rebuild = Promise.withResolvers<void>();
    const rebuildStarted = Promise.withResolvers<void>();
    const { spider, preparationCalls, invocationCalls } = makeJarCacheMissHarness(
      rebuild.promise,
      () => rebuildStarted.resolve(),
    );
    const controller = new AbortController();
    const call = spider.searchContent('query', false, 750, controller.signal);
    await rebuildStarted.promise;
    controller.abort(new Error('search cancelled during cache rebuild'));

    try {
      const outcome = await Promise.race([
        Promise.resolve(call).then(() => 'resolved', (error: unknown) => error instanceof Error && error.name === 'AbortError' ? 'aborted' : 'failed'),
        new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 0)),
      ]);
      expect(outcome).toBe('aborted');
      expect(preparationCalls()).toBe(2);
      expect(invocationCalls()).toBe(0);
    } finally {
      rebuild.resolve();
      await rebuild.promise;
    }
  });

  it('normalizes preparation failures and never invokes a spider that did not finish preparing', async () => {
    for (const { name, spider, preparationCalls, invocationCalls } of makeRuntimes(
      spiderCallSucceeded('unused'),
      undefined,
      new Error('runtime preparation failed'),
    )) {
      await expect(spider.searchContent('query', false, 750), `${name} preparation failure`)
        .rejects.toMatchObject({ code: 'SPIDER_ERROR' });
      expect(preparationCalls(), `${name} preparation`).toBe(1);
      expect(invocationCalls(), `${name} invocation`).toBe(0);
    }
  });
});

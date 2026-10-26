// tests/jsSandbox.spec.ts
// JS 沙箱端到端：合成蜘蛛（字符串脚本 + 内存 http mock）覆盖任务书 10 个场景。
import { describe, it, expect } from 'vitest';
import type { EngineHost, HttpRequest, HttpResponse, KVStore, Logger } from '../src/engine/ports';
import { JsSpider } from '../src/engine/js/JsSpider';
import { JsSandbox } from '../src/engine/js/JsSandbox';
import { Spider } from '../src/engine/spider/Spider';

/** 内存 mock 宿主：http（异步）/httpSync（同步 req 用）/kv/logger 全可断言 */
function makeHost(responses: Record<string, string>) {
  const kvMap = new Map<string, string>();
  const logs: string[] = [];
  const serve = (url: string): HttpResponse => {
    const hit = responses[url];
    if (hit === undefined) return { status: 404, headers: {}, content: '', finalUrl: url };
    return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, content: hit, finalUrl: url };
  };
  const http = {
    async request(req: HttpRequest): Promise<HttpResponse> {
      return serve(req.url);
    },
  };
  const kv: KVStore = {
    get: (k: string) => kvMap.get(k) ?? '',
    set: (k: string, v: string) => void kvMap.set(k, v),
    delete: (k: string) => void kvMap.delete(k),
  };
  const logger: Logger = {
    i: (t: string) => void logs.push(t),
    w: (t: string) => void logs.push(t),
    e: (t: string) => void logs.push(t),
  };
  const host: EngineHost = { http, kv, logger, jsLibDir: '' };
  // req() 同步语义走 httpSync（生产环境由沙箱内 spawnSync 兜底）
  (host as { httpSync?: unknown }).httpSync = (req: HttpRequest): HttpResponse => serve(req.url);
  return { host, kvMap, logs };
}

function makeSpider(code: string, extra: Record<string, string> = {}) {
  const api = 'https://mock.test/spider.js';
  const { host, kvMap, logs } = makeHost({ [api]: code, ...extra });
  const spider = new JsSpider({ key: 'test', api, ext: '', jar: '', host });
  return { spider, kvMap, logs };
}

describe('JsSpider — export default 形态', () => {
  it('init/homeContent/categoryContent 返回分类与列表', async () => {
    const { spider } = makeSpider(`
      var cats = [{ type_id: '1', type_name: '电影' }];
      export default {
        init(ext) { this.inited = true; },
        homeContent(filter) { return JSON.stringify({ class: cats, filters: {} }); },
        homeVideoContent() { return JSON.stringify({}); },
        categoryContent(tid, pg, filter, extend) {
          return JSON.stringify({ list: [{ vod_id: tid + '_' + pg, vod_name: '片名' }] });
        },
      };
    `);
    spider.init('');
    const home = JSON.parse(await spider.homeContent(true));
    expect(home.class[0].type_name).toBe('电影');
    const cat = JSON.parse(await spider.categoryContent('1', '2', false, {}));
    expect(cat.list[0].vod_id).toBe('1_2');
    expect(cat.list[0].vod_name).toBe('片名');
  });
});

describe('Spider — 同步与异步替换契约', () => {
  it.each(['localProxy', 'proxy', 'proxyLocal'])('通过基类 proxy 等待 JS %s 的响应后再序列化', async (method) => {
    const { spider } = makeSpider(`
      export default {
        async ${method}(params) { return ['application/json', JSON.stringify({ id: params.id })]; },
      };
    `);
    const source: Spider = spider;
    expect(await source.proxy({ id: 'episode-1' })).toBe('["application/json","{\\"id\\":\\"episode-1\\"}"]');
  });

  it('JS 未提供代理方法时保留空结果语义', async () => {
    const { spider } = makeSpider('export default { home() { return {}; } };');
    const source: Spider = spider;
    expect(await source.proxy({})).toBe('');
  });

  it('同步代理仍同步返回，空基类仍返回空字符串', () => {
    const { host } = makeHost({});
    const init = { key: 'test', api: '', ext: '', jar: '', host };
    class SyncProxySpider extends Spider {
      override proxyLocal() { return ['text/plain', 'ready']; }
    }
    class EmptySpider extends Spider {}
    expect(new SyncProxySpider(init).proxy({})).toBe('["text/plain","ready"]');
    expect(new EmptySpider(init).proxy({})).toBe('');
  });

  it('异步代理的拒绝沿基类契约传播，不被编码成成功响应', async () => {
    const { host } = makeHost({});
    const failure = new Error('proxy unavailable');
    class FailingProxySpider extends Spider {
      override async proxyLocal(): Promise<unknown[] | null> { throw failure; }
    }
    const source: Spider = new FailingProxySpider({ key: 'test', api: '', ext: '', jar: '', host });
    await expect(source.proxy({})).rejects.toBe(failure);
  });

  it('异步 action 通过基类类型保持可等待的返回契约', async () => {
    const { spider } = makeSpider('export default { async action(name) { return name + ":done"; } };');
    const source: Spider = spider;
    const pending: ReturnType<Spider['action']> = source.action('refresh');
    expect(await pending).toBe('refresh:done');
  });

  it('JS 分页搜索保留调用方超时预算和取消信号', async () => {
    const api = 'https://mock.test/paged-search.js';
    const { host } = makeHost({});
    let invocation: { names: string[]; args: unknown[]; timeoutMs: number; signal?: AbortSignal } | undefined;
    host.jsSandboxFactory = (init) => ({
      siteKey: init.siteKey,
      spiderStyle: 'unknown',
      setExt: () => undefined,
      ensureLoaded: async () => undefined,
      callMethod: async (names, args, timeoutMs, signal) => {
        invocation = { names, args, timeoutMs, signal };
        return '[]';
      },
      destroy: () => undefined,
    });
    const spider = new JsSpider({ key: 'paged-search', api, ext: '', jar: '', host });
    const controller = new AbortController();

    await expect(spider.searchContentPage('query', true, '4', 1250, controller.signal)).resolves.toBe('[]');
    expect(invocation).toEqual({
      names: ['searchContent', 'search'],
      args: ['query', true, '4'],
      timeoutMs: 1250,
      signal: controller.signal,
    });
  });
});

describe('JsSpider — __jsEvalReturn 形态', () => {
  it('function __jsEvalReturn + export 被识别并调用', async () => {
    const { spider } = makeSpider(`
      function __jsEvalReturn() {
        return { init: function () {}, homeContent: function () { return 'cat-home'; } };
      }
      export { __jsEvalReturn };
    `);
    expect(await spider.homeContent(true)).toBe('cat-home');
  });
});

describe('JsSpider — __JS_SPIDER__ 形态', () => {
  it('__JS_SPIDER__ = {...} 被替换为 export default', async () => {
    const { spider } = makeSpider(`
      var impl = { homeContent: function () { return 'spider3'; } };
      __JS_SPIDER__ = impl;
    `);
    expect(await spider.homeContent(true)).toBe('spider3');
  });
});

describe('JsSpider — 沙箱全局 API', () => {
  it('req() 同步取数（httpSync mock 返回 JSON）', async () => {
    const { spider } = makeSpider(`
      export default {
        homeContent() {
          var res = req('https://mock.test/api/list', {});
          return res.content;
        },
      };
    `, { 'https://mock.test/api/list': '{"list":[1,2,3]}' });
    expect(await spider.homeContent(true)).toBe('{"list":[1,2,3]}');
  });

  it('pdfh/pdfa 解析 mock 返回的 HTML', async () => {
    const { spider } = makeSpider(`
      export default {
        async homeContent() {
          var res = await req('https://mock.test/page.html', {});
          var list = pdfa(res.content, 'body&&.item');
          var first = pdfh(res.content, '.item&&a&&Text');
          return JSON.stringify({ first: first, count: list.length });
        },
      };
    `, { 'https://mock.test/page.html': '<div class="item"><a href="/1">A</a></div><div class="item"><a href="/2">B</a></div>' });
    const r = JSON.parse(await spider.homeContent(true));
    expect(r.first).toBe('A');
    expect(r.count).toBe(2);
  });

  it('local.set/get 落到 KVStore，键名为 jsRuntime_a_b', async () => {
    const { spider, kvMap } = makeSpider(`
      export default {
        homeContent() {
          local.set('a', 'b', 'hello-local');
          return local.get('a', 'b');
        },
      };
    `);
    expect(await spider.homeContent(true)).toBe('hello-local');
    expect(kvMap.get('jsRuntime_a_b')).toBe('hello-local');
  });

  it('local.get 键缺失 → 返回第二参数默认值（★2026-09-20 用户授权修复，上游仅异常时返回）', async () => {
    const { spider } = makeSpider(`
      export default {
        homeContent() {
          return local.get('no-such-key', 'fallback');
        },
      };
    `);
    expect(await spider.homeContent(true)).toBe('fallback');
  });

  it('aesX AES/CBC/PKCS5 加解密往返', async () => {
    const { spider } = makeSpider(`
      export default {
        homeContent() {
          var enc = aesX('AES/CBC/PKCS5', true, 'hello world', false, '0123456789abcdef', 'abcdef9876543210', true);
          var dec = aesX('AES/CBC/PKCS5', false, enc, true, '0123456789abcdef', 'abcdef9876543210', false);
          return JSON.stringify({ enc: enc, dec: dec });
        },
      };
    `);
    const r = JSON.parse(await spider.homeContent(true));
    expect(r.enc).not.toBe('');
    expect(r.dec).toBe('hello world');
  });

  it('$.require("net.js") 返回 { req, http }', async () => {
    const { spider } = makeSpider(`
      export default {
        homeContent() {
          var net = $.require('net.js');
          return typeof net.req === 'function' && typeof net.http === 'function' ? 'net-ok' : 'net-bad';
        },
      };
    `);
    expect(await spider.homeContent(true)).toBe('net-ok');
  });
});

describe('JsSpider — 降级与模块', () => {
  it('//bb 字节码脚本 → 返回明确的桌面端能力错误', async () => {
    const { spider } = makeSpider('//bbQ0FUT1A0GGxpYi91dGlscy5qcw==');
    await expect(spider.homeContent(true)).rejects.toMatchObject({
      code: 'JS_BYTECODE', message: expect.stringContaining('QuickJS 字节码'),
    });
  });

  it('import 相对路径依赖（./dep.js）', async () => {
    const { spider } = makeSpider(`
      import dep from './dep.js';
      export default {
        homeContent() { return dep.name; },
      };
    `, { 'https://mock.test/dep.js': "export default { name: 'dep-ok' };" });
    expect(await spider.homeContent(true)).toBe('dep-ok');
  });

  it('导出不可识别 → 保留格式不支持错误，不折叠为空结果', async () => {
    const { spider } = makeSpider('export const nothing = 42;');
    await expect(spider.homeContent(true)).rejects.toMatchObject({
      code: 'JS_FORMAT_UNSUPPORTED', message: expect.stringContaining('未导出可识别的蜘蛛对象'),
    });
  });

  it('方法名探测日志：drpy 风格（home/category）被记录', async () => {
    const { spider, logs } = makeSpider(`
      export default {
        init: function () {},
        home: function () { return 'drpy-home'; },
        category: function () { return '[]'; },
      };
    `);
    expect(await spider.homeContent(true)).toBe('drpy-home');
    expect(logs.some((l) => l.includes('方法名探测') && l.includes('drpy'))).toBe(true);
  });

  it('方法缺失可识别为能力缺失，合法 undefined 结果只执行一次', async () => {
    const { spider, kvMap } = makeSpider(`
      var calls = 0;
      export default {
        searchContent() { calls += 1; local.set('search', 'calls', String(calls)); },
      };
    `);
    await expect(spider.homeContent(true)).rejects.toMatchObject({ code: 'OPERATION_UNSUPPORTED' });
    expect(await spider.searchContent('query', false)).toBe('');
    expect(kvMap.get('jsRuntime_search_calls')).toBe('1');
  });

  it('瞬时脚本加载失败保留网络错误，后续调用可以重试', async () => {
    const api = 'https://mock.test/retry.js';
    const { host } = makeHost({ [api]: "export default { homeContent() { return 'recovered'; } };" });
    const request = host.http.request.bind(host.http);
    let shouldFail = true;
    host.http.request = async (req) => {
      if (req.url === api && shouldFail) {
        shouldFail = false;
        throw new Error('temporary network outage');
      }
      return request(req);
    };
    const spider = new JsSpider({ key: 'retry-source', api, ext: '', jar: '', host });

    await expect(spider.homeContent(true)).rejects.toMatchObject({ code: 'NETWORK' });
    await expect(spider.homeContent(true)).resolves.toBe('recovered');
  });
});

describe('JsSandbox — 调用契约', () => {
  it('取消脚本加载只结束当前等待者，不会破坏共享的加载任务', async () => {
    const api = 'https://mock.test/cancellable-load.js';
    const { host } = makeHost({ [api]: "export default { homeContent() { return 'loaded'; } };" });
    const requestStarted = Promise.withResolvers<void>();
    const finishRequest = Promise.withResolvers<HttpResponse>();
    host.http.request = async () => {
      requestStarted.resolve();
      return finishRequest.promise;
    };
    const sb = new JsSandbox({ siteKey: 'cancel-load', api, ext: '', host, jsLibDir: '' });
    const controller = new AbortController();
    const call = sb.callMethod(['homeContent'], [], 1000, controller.signal);

    await requestStarted.promise;
    controller.abort(new Error('load waiter cancelled'));
    await expect(call).rejects.toThrow('load waiter cancelled');

    finishRequest.resolve({
      status: 200,
      headers: { 'content-type': 'application/javascript' },
      content: "export default { homeContent() { return 'loaded'; } };",
      finalUrl: api,
    });
    await expect(sb.callMethod(['homeContent'], [], 1000)).resolves.toBe('loaded');
    sb.destroy();
  });

  it('取消运行中的脚本会立即结束调用方等待，但运行中的脚本仍完成其副作用', async () => {
    const api = 'https://mock.test/cancellable-call.js';
    const { host, kvMap } = makeHost({ [api]: `
      export default {
        async homeContent() {
          local.set('cancel', 'started', 'yes');
          await new Promise(function (resolve) { setTimeout(resolve, 80); });
          local.set('cancel', 'finished', 'yes');
          return 'late result';
        },
      };
    ` });
    const callStarted = Promise.withResolvers<void>();
    const originalSet = host.kv.set.bind(host.kv);
    host.kv.set = (key, value) => {
      originalSet(key, value);
      if (key === 'jsRuntime_cancel_started') callStarted.resolve();
    };
    const sb = new JsSandbox({ siteKey: 'cancel-call', api, ext: '', host, jsLibDir: '' });
    const controller = new AbortController();
    const call = sb.callMethod(['homeContent'], [], 1000, controller.signal);

    await callStarted.promise;
    controller.abort(new Error('search superseded'));
    await expect(call).rejects.toThrow('search superseded');
    expect(kvMap.has('jsRuntime_cancel_finished')).toBe(false);
    const sandboxState = sb as unknown as { ctx: unknown };
    const contextDuringCall = sandboxState.ctx;
    expect(contextDuringCall).not.toBeNull();
    sb.destroy();
    expect(sandboxState.ctx).toBe(contextDuringCall);
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    expect(kvMap.get('jsRuntime_cancel_finished')).toBe('yes');
    expect(sandboxState.ctx).toBeNull();
    sb.destroy();
  });

  it('脚本异常保留操作身份，正常 undefined 仍是成功值', async () => {
    const { host } = makeHost({ 'https://mock.test/spider.js': `
      export default {
        homeContent() { throw new Error('script-boom'); },
        homeVideoContent() { return undefined; },
      };
    ` });
    const sb = new JsSandbox({ siteKey: 'typed', api: 'https://mock.test/spider.js', ext: '', host, jsLibDir: '' });
    await expect(sb.callMethod(['homeContent'], [], 1000)).rejects.toMatchObject({
      code: 'SPIDER_ERROR', detail: { sourceKey: 'typed', operation: 'homeContent' },
    });
    await expect(sb.callMethod(['homeVideoContent'], [], 1000)).resolves.toBeUndefined();
    sb.destroy();
  });

  it('操作超时返回独立错误码，之后的有限调用仍可工作', async () => {
    const { host } = makeHost({ 'https://mock.test/spider.js': `
      var calls = 0;
      export default {
        async homeContent() {
          calls += 1;
          if (calls === 1) return await new Promise(function (r) { setTimeout(function () { r('late'); }, 40); });
          return 'ready';
        },
      };
    ` });
    const sb = new JsSandbox({ siteKey: 't', api: 'https://mock.test/spider.js', ext: '', host, jsLibDir: '' });
    await expect(sb.callMethod(['homeContent'], [], 5)).rejects.toMatchObject({
      code: 'SPIDER_TIMEOUT', detail: { sourceKey: 't', operation: 'homeContent' },
    });
    await expect(sb.callMethod(['homeContent'], [], 1000)).resolves.toBe('ready');
    sb.destroy();
  });
});

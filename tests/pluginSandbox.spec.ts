// tests/pluginSandbox.spec.ts
// R10 L4 沙箱：**权限门禁**（未授权的 winbox.* 不存在）+ 最小全局集 + KV 前缀 + 宿主 API 的 fs 越界。
//   ★ 全部为**纯函数**测试 —— 不起真 worker（worker 真链路见真机探针）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildWinbox } from '../src/main/plugin/sandbox/buildWinbox';
import { PluginKv } from '../src/main/plugin/PluginKv';
import { JsonStore } from '../src/main/store/JsonStore';
import { createPluginSandboxApi, type PluginSandboxApiDeps } from '../src/main/plugin/pluginHostApi';
import type { HostCall } from '../src/main/plugin/sandbox/protocol';
import type { PermissionId } from '../src/shared/plugin';
import type { HttpResponse } from '../src/shared/types';

/** 记录调用并返回固定值的假桥 */
function recorder(value: unknown = true): { calls: HostCall[]; call: (m: HostCall) => Promise<unknown> } {
  const calls: HostCall[] = [];
  return {
    calls,
    call: (m: HostCall) => {
      calls.push(m);
      if (m.t === 'http') return Promise.resolve(value);
      return Promise.resolve(value);
    },
  };
}

const noopLogger = { i: (): void => undefined, w: (): void => undefined, e: (): void => undefined };

describe('buildWinbox — 权限门禁（未授权组不存在）', () => {
  it('只授权 log：log 存在，kv/clipboard/http/fs 均 undefined（调用即 TypeError）', () => {
    const { winbox } = buildWinbox(['log'] as PermissionId[], recorder().call);
    expect(typeof winbox.log).toBe('object');
    expect(winbox.kv).toBeUndefined();
    expect(winbox.clipboard).toBeUndefined();
    expect(winbox.http).toBeUndefined();
    expect(winbox.fs).toBeUndefined();
    expect(winbox.player).toBeUndefined();
    expect(winbox.openExternal).toBeUndefined();
  });

  it('空权限：winbox 为空对象（一个组都不挂）', () => {
    const { winbox } = buildWinbox([], recorder().call);
    expect(Object.keys(winbox)).toHaveLength(0);
  });

  it('kv：get/set/delete 存在，且以正确的 HostCall 走桥', async () => {
    const r = recorder('V');
    const { winbox } = buildWinbox(['kv'] as PermissionId[], r.call);
    const kv = winbox.kv as { get: (k: string) => Promise<unknown>; set: (k: string, v: unknown) => Promise<unknown>; delete: (k: string) => Promise<unknown> };
    expect(await kv.get('a')).toBe('V');
    await kv.set('a', '1');
    await kv.delete('a');
    expect(r.calls.map((c) => (c as { op?: string }).op)).toEqual(['get', 'set', 'delete']);
    expect(r.calls.map((c) => (c as { key: string }).key)).toEqual(['a', 'a', 'a']);
    expect((r.calls[1] as { val?: string }).val).toBe('1');
  });

  it('clipboard 按权限细分：只授 read → 有 read 无 write', () => {
    const { winbox } = buildWinbox(['clipboard.read'] as PermissionId[], recorder().call);
    const clip = winbox.clipboard as { read?: unknown; write?: unknown };
    expect(typeof clip.read).toBe('function');
    expect(clip.write).toBeUndefined();
  });

  it('net.http：包装成 { status, headers, text() }（text 在沙箱内包装）', async () => {
    const r = recorder({ status: 200, headers: { a: 'b' }, content: 'HELLO' });
    const { winbox } = buildWinbox(['net'] as PermissionId[], r.call);
    const http = winbox.http as (u: string) => Promise<{ status: number; text: () => string }>;
    const res = await http('https://x/');
    expect(res.status).toBe(200);
    expect(res.text()).toBe('HELLO');
    expect((r.calls[0] as unknown as { t: string }).t).toBe('http');
  });

  it('net.download：deliverProgress 按 id 派发到 onProgress', async () => {
    const r = recorder({ bytes: 10 });
    const wg = buildWinbox(['net.download'] as PermissionId[], r.call);
    const seen: Array<[number, number]> = [];
    const download = wg.winbox.download as (u: string, n: string, cb: (l: number, t: number) => void) => Promise<unknown>;
    const p = download('https://x/f', 'f.bin', (l, t) => seen.push([l, t]));
    wg.deliverProgress(1, 5, 10);
    await p;
    expect(seen).toEqual([[5, 10]]);
  });

  it('openExternal：非 http(s) 本地即抛（不落到宿主）', () => {
    const { winbox } = buildWinbox(['openExternal'] as PermissionId[], recorder().call);
    const fn = winbox.openExternal as (u: string) => unknown;
    expect(() => fn('file:///etc/passwd')).toThrow();
  });
});

describe('buildWinbox — 最小全局集（无 require/process/fs/Buffer）', () => {
  it('提供 console / 定时器 / 编码 / URL；不提供 require/process/Buffer/module', () => {
    const { globals } = buildWinbox([] as PermissionId[], recorder().call);
    expect(typeof globals.console).toBe('object');
    expect(typeof globals.setTimeout).toBe('function');
    expect(typeof globals.clearTimeout).toBe('function');
    expect(typeof globals.TextEncoder).toBe('function');
    expect(typeof globals.URL).toBe('function');
    expect(globals.require).toBeUndefined();
    expect(globals.process).toBeUndefined();
    expect(globals.Buffer).toBeUndefined();
    expect(globals.module).toBeUndefined();
    expect(globals.exports).toBeUndefined();
    expect(globals.global).toBeUndefined();
  });
});

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'winbox-l4-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('PluginKv — 命名空间隔离（前缀 plugin:<id>:）', () => {
  it('同名 key 在不同插件间不串；delete 生效；flush 落盘带前缀', () => {
    const file = join(root, 'plugin-kv.json');
    const kv = new PluginKv(new JsonStore(file));
    kv.set('p1', 'k', 'v1');
    kv.set('p2', 'k', 'v2');
    expect(kv.get('p1', 'k')).toBe('v1');
    expect(kv.get('p2', 'k')).toBe('v2');
    kv.delete('p1', 'k');
    expect(kv.get('p1', 'k')).toBe('');
    kv.flush();
    const onDisk = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, string>;
    expect(onDisk['plugin:p2:k']).toBe('v2');
    expect(onDisk['plugin:p1:k']).toBeUndefined();
  });
});

describe('createPluginSandboxApi — fs 越界 / 写读 / settings', () => {
  let pluginsDir: string;
  let deps: PluginSandboxApiDeps;

  beforeEach(() => {
    pluginsDir = join(root, 'plugins');
    mkdirSync(join(pluginsDir, 'demo.winbox'), { recursive: true });
    deps = {
      http: {
        request: async (req): Promise<HttpResponse> =>
          req.buffer
            ? { status: 200, headers: { 'content-length': '2' }, content: [104, 105], finalUrl: req.url }
            : { status: 200, headers: {}, content: 'OK', finalUrl: req.url },
      },
      logger: noopLogger,
      pluginsDir,
      settings: { get: (id, key) => `${id}:${key}`, set: () => undefined },
      kv: new PluginKv(new JsonStore(join(root, 'kv.json'))),
      playerRelay: () => ({ ok: true }),
      notify: () => undefined,
      clipboardRead: () => 'clip',
      clipboardWrite: () => undefined,
      dialogBox: async () => true,
      openExternal: () => undefined,
    };
  });

  it('fs 越界（../ 与绝对路径）一律拒绝', () => {
    const api = createPluginSandboxApi(deps);
    expect(() => api.fs('demo', 'read', '../x')).toThrow();
    expect(() => api.fs('demo', 'write', '/abs')).toThrow();
    expect(() => api.fs('demo', 'read', '..')).toThrow();
  });

  it('fs 合法相对路径：写入落在 <pluginsDir>/<id>.winbox 内，可读回', () => {
    const api = createPluginSandboxApi(deps);
    api.fs('demo', 'write', 'a/b.txt', 'hi');
    expect(existsSync(join(pluginsDir, 'demo.winbox', 'a', 'b.txt'))).toBe(true);
    expect(api.fs('demo', 'read', 'a/b.txt')).toBe('hi');
    expect(api.fs('demo', 'exists', 'a/b.txt')).toBe(true);
    expect(api.fs('demo', 'list', 'a')).toEqual(['b.txt']);
    api.fs('demo', 'delete', 'a/b.txt');
    expect(api.fs('demo', 'exists', 'a/b.txt')).toBe(false);
  });

  it('http 映射为 { status, headers, content }', async () => {
    const api = createPluginSandboxApi(deps);
    const r = await api.http('demo', 'https://x/', { method: 'get' });
    expect(r.status).toBe(200);
    expect(r.content).toBe('OK');
  });

  it('download：写文件到插件目录并报「开始/完成」两帧', async () => {
    const api = createPluginSandboxApi(deps);
    const seen: Array<[number, number]> = [];
    const r = await api.download('demo', 'https://x/f', 'f.bin', (l, t) => seen.push([l, t]));
    expect(r.bytes).toBe(2);
    expect(existsSync(join(pluginsDir, 'demo.winbox', 'f.bin'))).toBe(true);
    expect(seen[0]).toEqual([0, 2]);
    expect(seen[seen.length - 1]).toEqual([2, 2]);
  });

  it('settings 委托宿主：set 不合法时把宿主的抛错透出（插件侧收到 reject）', () => {
    const api = createPluginSandboxApi({
      ...deps,
      settings: {
        get: () => undefined,
        set: () => {
          throw new Error('值非法');
        },
      },
    });
    expect(api.settings('demo', 'get', 'k')).toBeUndefined();
    expect(() => api.settings('demo', 'set', 'k', 1)).toThrow('值非法');
  });

  it('kv 经 API 写入带 plugin:<id>: 前缀', () => {
    const api = createPluginSandboxApi(deps);
    api.kv('demo', 'set', 'x', '1');
    expect(api.kv('demo', 'get', 'x')).toBe('1');
    const onDisk = JSON.parse(readFileSync(join(root, 'kv.json'), 'utf-8')) as Record<string, string>;
    expect(onDisk['plugin:demo:x']).toBe('1');
  });

  it('openExternal 仅 http(s)', async () => {
    const api = createPluginSandboxApi(deps);
    await expect(api.openExternal('demo', 'file:///x')).rejects.toThrow();
  });
});

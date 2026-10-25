// tests/remoteControlRoutes.spec.ts
import { describe, expect, it } from 'vitest';
import { RemoteControlRoutes, type RemotePushAction } from '../src/main/server/RemoteControlRoutes';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';

function createMockReq(method: string, url: string, body = ''): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage;
  req.method = method;
  req.url = url;
  req.headers = { host: '127.0.0.1:9978' };
  process.nextTick(() => {
    if (body) {
      req.emit('data', Buffer.from(body, 'utf-8'));
    }
    req.emit('end');
  });
  return req;
}

function createMockRes(): { res: ServerResponse; getOutput: () => { statusCode: number; headers: Record<string, string>; body: string } } {
  let statusCode = 200;
  const headers: Record<string, string> = {};
  const chunks: Buffer[] = [];
  const res = {
    writeHead(code: number, h?: Record<string, string>) {
      statusCode = code;
      if (h) Object.assign(headers, h);
      return res;
    },
    end(data?: string | Buffer) {
      if (data) chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf-8'));
    },
  } as unknown as ServerResponse;

  return {
    res,
    getOutput: () => ({
      statusCode,
      headers,
      body: Buffer.concat(chunks).toString('utf-8'),
    }),
  };
}

describe('RemoteControlRoutes — 9978 局域网控制台与手机推送', () => {
  const logger = { i: () => undefined, w: () => undefined, e: () => undefined };

  it('matches() 准确识别控制台路由', () => {
    const routes = new RemoteControlRoutes({
      assetsDir: () => './resources/web/remote-push',
      logger,
    });
    expect(routes.matches('/')).toBe(true);
    expect(routes.matches('/index.html')).toBe(true);
    expect(routes.matches('/style.css')).toBe(true);
    expect(routes.matches('/script.js')).toBe(true);
    expect(routes.matches('/action')).toBe(true);
    expect(routes.matches('/play')).toBe(false);
    expect(routes.matches('/img')).toBe(false);
  });

  it('GET / 返回控制台 HTML 页面', async () => {
    const routes = new RemoteControlRoutes({
      assetsDir: () => './resources/web/remote-push',
      logger,
    });
    const req = createMockReq('GET', '/');
    const { res, getOutput } = createMockRes();
    await routes.handle(new URL('http://127.0.0.1:9978/'), req, res);
    const out = getOutput();
    expect(out.statusCode).toBe(200);
    expect(out.headers['Content-Type']).toContain('text/html');
    expect(out.body).toContain('Win-Box');
  });

  it('OPTIONS /action 响应 CORS 预检', async () => {
    const routes = new RemoteControlRoutes({
      assetsDir: () => './resources/web/remote-push',
      logger,
    });
    const req = createMockReq('OPTIONS', '/action');
    const { res, getOutput } = createMockRes();
    await routes.handle(new URL('http://127.0.0.1:9978/action'), req, res);
    const out = getOutput();
    expect(out.statusCode).toBe(204);
    expect(out.headers['Access-Control-Allow-Origin']).toBe('*');
  });

  it('POST /action 处理 pushStore（推送多仓/线路）', async () => {
    const actions: RemotePushAction[] = [];
    const routes = new RemoteControlRoutes({
      assetsDir: () => './resources/web/remote-push',
      logger,
      onAction: (a) => { actions.push(a); },
    });
    const body = new URLSearchParams({
      do: 'pushStore',
      pushStore_name: '测试仓库',
      pushStore_url: 'https://store.example/tv.json',
    }).toString();
    const req = createMockReq('POST', '/action', body);
    const { res, getOutput } = createMockRes();
    await routes.handle(new URL('http://127.0.0.1:9978/action'), req, res);
    const out = getOutput();
    expect(out.statusCode).toBe(200);
    expect(out.body).toBe('ok');
    expect(actions.length).toBe(1);
    expect(actions[0].do).toBe('pushStore');
    expect(actions[0].name).toBe('测试仓库');
    expect(actions[0].url).toBe('https://store.example/tv.json');
  });

  it('POST /action 处理 push（推送视频链接到播放器）', async () => {
    const actions: RemotePushAction[] = [];
    const routes = new RemoteControlRoutes({
      assetsDir: () => './resources/web/remote-push',
      logger,
      onAction: (a) => { actions.push(a); },
    });
    const body = new URLSearchParams({
      do: 'push',
      url: 'https://cdn.example/video.mp4',
    }).toString();
    const req = createMockReq('POST', '/action', body);
    const { res } = createMockRes();
    await routes.handle(new URL('http://127.0.0.1:9978/action'), req, res);
    expect(actions.length).toBe(1);
    expect(actions[0].do).toBe('push');
    expect(actions[0].url).toBe('https://cdn.example/video.mp4');
  });

  it('POST /action 处理 pushAliToken（推送阿里云盘 Token）', async () => {
    const actions: RemotePushAction[] = [];
    const routes = new RemoteControlRoutes({
      assetsDir: () => './resources/web/remote-push',
      logger,
      onAction: (a) => { actions.push(a); },
    });
    const body = new URLSearchParams({
      do: 'pushAliToken',
      push_AliToken: 'mock_token_abc123',
    }).toString();
    const req = createMockReq('POST', '/action', body);
    const { res } = createMockRes();
    await routes.handle(new URL('http://127.0.0.1:9978/action'), req, res);
    expect(actions.length).toBe(1);
    expect(actions[0].do).toBe('pushAliToken');
    expect(actions[0].token).toBe('mock_token_abc123');
  });

  it('POST /action 处理 danmaku 实时弹幕推送', async () => {
    const actions: RemotePushAction[] = [];
    const routes = new RemoteControlRoutes({
      assetsDir: () => './resources/web/remote-push',
      logger,
      onAction: (a) => { actions.push(a); },
    });
    const body = new URLSearchParams({
      type: 'danmaku',
      path: '前方高能！',
    }).toString();
    const req = createMockReq('POST', '/action', body);
    const { res } = createMockRes();
    await routes.handle(new URL('http://127.0.0.1:9978/action'), req, res);
    expect(actions.length).toBe(1);
    expect(actions[0].do).toBe('danmaku');
    expect(actions[0].text).toBe('前方高能！');
  });
});

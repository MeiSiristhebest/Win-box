// tests/m3u8Proxy.spec.ts — CatVod `do=m3u8` 清单中继回归。
// 使用真实本地 HTTP 请求验证清单、子清单、key、初始化段和分片，不依赖在线账号。
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';

vi.mock('electron', () => ({
  app: { getPath: () => process.env.TEMP || '.', isPackaged: false },
  safeStorage: { isEncryptionAvailable: () => false },
}));

import {
  decodeProxyHeaders,
  LocalProxyServer,
  rewriteM3u8WithHeaders,
} from '../src/main/server/LocalProxyServer';
import { wrapPlayUrlWithHeaders } from '../src/shared/driveProvider';
import { isHlsPlaylistUrl } from '../src/shared/playbackResult';

let upstream: Server;
let proxy: LocalProxyServer;
let upstreamBase = '';
let proxyBase = '';
const seen: Array<{ url: string; headers: Record<string, string | string[] | undefined> }> = [];
const headers = {
  'user-agent': 'CatVod-Test/1.0',
  referer: 'https://source.example/path?q=a+b&name=%E7%89%87',
  Origin: 'https://source.example',
  cookie: 'sid=a+b; sig=x:y/z==',
  authorization: 'Bearer fixture-token',
  'X-Test': 'space + : ; / = %',
};
const expectedHeaders = {
  'user-agent': headers['user-agent'], referer: headers.referer, origin: headers.Origin,
  cookie: headers.cookie, authorization: headers.authorization, 'x-test': headers['X-Test'],
};
const tokenQuery = '?token=a%2Bb%2Fc%3D&part=1';
const formEncode = (s: string): string => new URLSearchParams({ v: s }).toString().slice(2);
// 与缓存 DC.B 字节码一致：分别 form encode 名/值，用 : / ; 拼接，再 Base64(NO_WRAP)。
function catvodHeaders(input: Record<string, string>): string {
  const serialized = Object.entries(input).map(([k, v]) => `${formEncode(k)}:${formEncode(v)}`).join(';');
  return Buffer.from(serialized, 'utf8').toString('base64');
}
function proxyUrl(path: string, input: Record<string, string> = headers): string {
  // DC.B 的 Base64 没再经 URLEncoder；保留这一细节作真实请求回归。
  return `${proxyBase}/proxy?do=m3u8&url=${formEncode(upstreamBase + path)}&headers=${catvodHeaders(input)}`;
}

beforeEach(() => { seen.length = 0; });

beforeAll(async () => {
  upstream = createServer((req, res) => {
    seen.push({ url: req.url || '', headers: req.headers });
    const path = new URL(req.url || '/', 'http://fixture').pathname;
    if (path === '/browser/list.m3u8' || path === '/browser/segment.ts' ||
      path === '/browser/hls/live/master' || path === '/browser/hls/live/segment.ts') {
      if (req.headers['user-agent'] !== 'Chromium Acceptance/1.0') {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('missing browser user agent');
        return;
      }
      if (path === '/browser/list.m3u8' || path === '/browser/hls/live/master') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('#EXTM3U\n#EXTINF:1,\nsegment.ts\n#EXT-X-ENDLIST\n');
      } else {
        res.writeHead(200, { 'Content-Type': 'video/mp2t' });
        res.end('fixture-segment');
      }
      return;
    }
    if (!Object.entries(expectedHeaders).every(([k, v]) => req.headers[k] === v)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('missing media headers');
      return;
    }
    if (path === '/playlist.m3u8' || path === '/entry') {
      res.writeHead(302, { Location: '/hls/final/master' + tokenQuery });
      res.end();
      return;
    }
    if (path === '/hls/final/master') {
      // 无 .m3u8 扩展名且上游类型不准确：do=m3u8 仍需按清单处理。
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nchild.m3u8' + tokenQuery + '\n');
      return;
    }
    if (path === '/hls/final/child.m3u8') {
      res.writeHead(302, { Location: '/hls/media/list' + tokenQuery });
      res.end();
      return;
    }
    if (path === '/hls/media/list') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin' + tokenQuery + '"\n' +
        '#EXT-X-SESSION-KEY:METHOD=AES-128,URI="key' + tokenQuery + '"\n' +
        '#EXT-X-MAP:URI="init.mp4' + tokenQuery + '"\n#EXTINF:1,\nseg-01.ts' + tokenQuery + '\n#EXT-X-ENDLIST\n');
      return;
    }
    if (path === '/webp-list.m3u8') {
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      res.end('#EXTM3U\n#EXTINF:5,\nwebp-segment.webp\n#EXT-X-ENDLIST\n');
      return;
    }
    if (path === '/webp-segment.webp') {
      const ts = Buffer.alloc(188 * 5, 0xaa);
      for (let i = 0; i < 5; i++) ts[i * 188] = 0x47;
      const prefix = Buffer.alloc(936);
      prefix.write('RIFF', 0); prefix.writeUInt32LE(prefix.length + ts.length - 8, 4);
      prefix.write('WEBP', 8); prefix.write('VP8 ', 12); prefix.writeUInt32LE(908, 16);
      prefix.write('TS_D', 928); prefix.writeUInt32LE(ts.length, 932);
      res.writeHead(200, { 'Content-Type': 'image/webp', 'Content-Length': String(prefix.length + ts.length) });
      res.write(prefix.subarray(0, 2));
      // A short RIFF head must not stop sniffing before the complete envelope.
      setTimeout(() => res.end(Buffer.concat([prefix.subarray(2), ts])), 10);
      return;
    }
    if (path === '/bad.m3u8') {
      const body = Buffer.from('{"error":"upstream returned JSON"}');
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': String(body.length) });
      res.end(body);
      return;
    }
    if (path === '/oversized.m3u8') {
      const body = Buffer.concat([Buffer.from('#EXTM3U\n'), Buffer.alloc(8 * 1024 * 1024, 0x61)]);
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Content-Length': String(body.length) });
      res.end(body);
      return;
    }
    if (path === '/hinted-video.m3u8') {
      // A misleading playlist URL must not make a large, explicitly typed media
      // response enter the buffered HLS manifest path.
      const body = Buffer.alloc(10 * 1024 * 1024, 0x41);
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(body.length) });
      res.end(body);
      return;
    }
    if (path === '/hls/media/key.bin' || path === '/hls/media/key' || path === '/hls/media/init.mp4' || path === '/hls/media/seg-01.ts') {
      const body = Buffer.from(path.endsWith('/key.bin') || path.endsWith('/key') ? 'fixture-key-12345' : 'fixture-segment');
      const range = req.headers.range;
      res.writeHead(range ? 206 : 200, {
        'Content-Type': 'application/octet-stream', 'Content-Length': String(body.length),
        'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes 1-${body.length}/${body.length + 1}` } : {}),
      });
      res.end(body);
      return;
    }
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('upstream forbidden: key.bin; signed/path');
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamAddress = upstream.address();
  if (!upstreamAddress || typeof upstreamAddress === 'string') throw new Error('missing upstream port');
  upstreamBase = `http://127.0.0.1:${upstreamAddress.port}`;

  proxy = new LocalProxyServer({ i: () => {}, w: () => {}, e: () => {} });
  await proxy.start(0);
  const server = (proxy as unknown as { server: Server }).server;
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing proxy port');
  proxyBase = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  proxy?.stop();
  if (upstream) await new Promise<void>((resolve) => upstream.close(() => resolve()));
});

describe('CatVod do=m3u8', () => {
  it('recognizes HLS manifests with query strings and ignores non-HLS/local relays', () => {
    expect(isHlsPlaylistUrl('https://cdn.example/list.m3u8?token=abc')).toBe(true);
    expect(isHlsPlaylistUrl('https://cdn.example/watch?format=hls')).toBe(true);
    expect(isHlsPlaylistUrl('https://cdn.example/hls/live/channel')).toBe(true);
    expect(isHlsPlaylistUrl('https://cdn.example/hls/live/segment.ts')).toBe(false);
    expect(isHlsPlaylistUrl('https://cdn.example/hls/live/key.bin')).toBe(false);
    expect(isHlsPlaylistUrl('https://cdn.example/hls/live/captions.vtt')).toBe(false);
    expect(isHlsPlaylistUrl('https://cdn.example/watch?TYPE=M3U8')).toBe(true);
    expect(isHlsPlaylistUrl('https://cdn.example/movie.mp4')).toBe(false);
    expect(isHlsPlaylistUrl('http://127.0.0.1:9978/play?url=https%3A%2F%2Fcdn.example%2Flist.m3u8')).toBe(false);
  });

  it('proxies ordinary HLS direct URLs with the Chromium UA and rewrites their segments', async () => {
    const browserUA = 'Chromium Acceptance/1.0';
    const response = await fetch(`${proxyBase}/play?url=${formEncode(upstreamBase + '/browser/list.m3u8')}`, {
      headers: { 'User-Agent': browserUA },
    });
    expect(response.status).toBe(200);
    const manifest = await response.text();
    const segmentUrl = manifest.split('\n').find(line => line.startsWith('http'))!;
    expect(new URL(segmentUrl).origin).toBe(proxyBase);
    expect(new URL(segmentUrl).searchParams.get('ua')).toBe(browserUA);
    const segment = await fetch(segmentUrl);
    expect(segment.status).toBe(200);
    expect(await segment.text()).toBe('fixture-segment');
    expect(seen.map(item => item.url)).toEqual(['/browser/list.m3u8', '/browser/segment.ts']);
    expect(seen.every(item => item.headers['user-agent'] === browserUA)).toBe(true);
  });

  it('rewrites extensionless /hls/ manifests even when the origin labels them text/plain', async () => {
    const browserUA = 'Chromium Acceptance/1.0';
    const response = await fetch(`${proxyBase}/play?url=${formEncode(upstreamBase + '/browser/hls/live/master')}`, {
      headers: { 'User-Agent': browserUA },
    });
    expect(response.status).toBe(200);
    const manifest = await response.text();
    expect(manifest).toContain('#EXTM3U');
    const segmentUrl = manifest.split('\n').find(line => line.startsWith('http'))!;
    expect(new URL(segmentUrl).origin).toBe(proxyBase);
    expect(new URL(segmentUrl).searchParams.get('ua')).toBe(browserUA);
    const segment = await fetch(segmentUrl);
    expect(segment.status).toBe(200);
    expect(await segment.text()).toBe('fixture-segment');
    expect(seen.map(item => item.url)).toEqual(['/browser/hls/live/master', '/browser/hls/live/segment.ts']);
  });

  it('does not treat a JSON error body as a successful HLS manifest', async () => {
    const response = await fetch(proxyUrl('/bad.m3u8'));

    expect(response.status).toBe(502);
    expect(response.headers.get('x-winbox-error-code')).toBe('HTTP_INVALID_MANIFEST');
    expect(await response.text()).toContain('不是有效的 HLS 清单');
  });

  it('fails an oversized manifest visibly instead of returning a truncated playlist', async () => {
    const response = await fetch(proxyUrl('/oversized.m3u8'));

    expect(response.status).toBe(502);
    expect(response.headers.get('x-winbox-error-code')).toBe('HTTP_RESPONSE_TOO_LARGE');
    expect(await response.text()).toContain('超过字节上限');
  });

  it('streams a large video response even when the source URL looks like a playlist', async () => {
    const response = await fetch(proxyUrl('/hinted-video.m3u8'));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('video/mp4');
    expect(response.headers.get('content-length')).toBe(String(10 * 1024 * 1024));
    expect((await response.arrayBuffer()).byteLength).toBe(10 * 1024 * 1024);
  });

  it('WebP TS_D 分片流式剥离前导、正确 MIME/长度，且使用 .ts 路由', async () => {
    const playlist = await (await fetch(proxyUrl('/webp-list.m3u8'))).text();
    const segment = playlist.split('\n').find(line => line.startsWith('http'))!;
    expect(new URL(segment).pathname).toBe('/play/segment.ts');
    const response = await fetch(segment);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('video/mp2t');
    expect(response.headers.get('content-length')).toBe(String(188 * 5));
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.length).toBe(188 * 5);
    for (let i = 0; i < 5; i++) expect(body[i * 188]).toBe(0x47);
  });
  it('以 JAR 实际协议拉取重定向清单、子清单、key、初始化段和分片', async () => {
    const response = await fetch(proxyUrl('/entry' + tokenQuery));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('mpegurl');
    const master = await response.text();
    const childUrl = master.split('\n')[2];
    expect(new URL(childUrl).origin).toBe(proxyBase);
    expect(new URL(childUrl).searchParams.get('url')).toBe(upstreamBase + '/hls/final/child.m3u8' + tokenQuery);
    const childResponse = await fetch(childUrl);
    expect(childResponse.status).toBe(200);
    const child = await childResponse.text();
    const assets = [...child.matchAll(/URI="([^"]+)"/g)].map((m) => m[1]);
    assets.push(child.split('\n')[5]);
    expect(assets).toHaveLength(4);
    for (const asset of assets) {
      expect(new URL(asset).origin).toBe(proxyBase);
      expect(new URL(asset).searchParams.get('url')).toContain(upstreamBase + '/hls/media/');
      expect(new URL(asset).searchParams.get('url')).toContain(tokenQuery);
      expect(new URL(asset).searchParams.get('hlsResource')).toBe('asset');
      const result = await fetch(asset);
      expect(result.status).toBe(200);
      const target = new URL(asset).searchParams.get('url') || '';
      expect(await result.text()).toBe(/\/key(?:\.bin)?\?/.test(target) ? 'fixture-key-12345' : 'fixture-segment');
    }
    expect(seen.map((r) => r.url)).toEqual([
      '/entry' + tokenQuery, '/hls/final/master' + tokenQuery,
      '/hls/final/child.m3u8' + tokenQuery, '/hls/media/list' + tokenQuery,
      '/hls/media/key.bin' + tokenQuery, '/hls/media/key' + tokenQuery,
      '/hls/media/init.mp4' + tokenQuery, '/hls/media/seg-01.ts' + tokenQuery,
    ]);
    for (const r of seen) expect(r.headers).toMatchObject(expectedHeaders);
  });

  it('外层 /play 包装的本地 m3u8 入口不会重复包装已重写的 URI', async () => {
    const outer = new URL(wrapPlayUrlWithHeaders(proxyUrl('/playlist.m3u8'), {}));
    const response = await fetch(proxyBase + outer.pathname + outer.search);
    expect(response.status).toBe(200);
    const childUrl = (await response.text()).split('\n')[2];
    expect(new URL(childUrl).searchParams.get('url')).toBe(upstreamBase + '/hls/final/child.m3u8' + tokenQuery);
    const child = await fetch(childUrl);
    expect(child.status).toBe(200);
    await child.text();
  });

  it('playerContent.header 与内层 m3u8 headers 合并后用于真正的上游请求', async () => {
    const { Origin, authorization, ...innerHeaders } = headers;
    const outer = new URL(wrapPlayUrlWithHeaders(proxyUrl('/entry', innerHeaders), {
      Origin, authorization,
    }));
    const response = await fetch(proxyBase + outer.pathname + outer.search);
    expect(response.status).toBe(200);
    const child = await fetch((await response.text()).split('\n')[2]);
    expect(child.status).toBe(200);
    await child.text();
    for (const r of seen) expect(r.headers).toMatchObject(expectedHeaders);
  });

  it('保留媒体 Range/HEAD 响应头，并透传上游失败状态和原始正文', async () => {
    const wrapped = new URL(wrapPlayUrlWithHeaders(upstreamBase + '/hls/media/seg-01.ts', headers));
    const relay = proxyBase + wrapped.pathname + wrapped.search;
    const partial = await fetch(relay, { headers: { Range: 'bytes=1-15' } });
    expect(partial.status).toBe(206);
    expect(partial.headers.get('content-range')).toBe('bytes 1-15/16');
    expect(await partial.text()).toBe('fixture-segment');
    expect(seen[0].headers.range).toBe('bytes=1-15');
    expect(seen[0].headers).toMatchObject(expectedHeaders);
    const head = await fetch(relay, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe('15');
    expect(await head.text()).toBe('');
    const failed = await fetch(proxyUrl('/failed.m3u8'));
    expect(failed.status).toBe(403);
    expect(failed.headers.get('content-type')).toBe('text/plain');
    expect(await failed.text()).toBe('upstream forbidden: key.bin; signed/path');
  });

  it('无效目标或 headers 返回 400，且不发起上游请求', async () => {
    for (const query of ['do=m3u8', 'do=m3u8&url=file%3A%2F%2F%2Ftest',
      `do=m3u8&url=${formEncode(upstreamBase + '/entry')}&headers=invalid`]) {
      const response = await fetch(proxyBase + '/proxy?' + query);
      expect(response.status).toBe(400);
      await response.text();
    }
    expect(seen).toHaveLength(0);
  });

  it('解码 DC.B 的 form 编码 header，保留值中的 +、:、;、%、Cookie 和签名', () => {
    expect(decodeProxyHeaders(catvodHeaders(headers))).toEqual({
      'User-Agent': headers['user-agent'], Referer: headers.referer, Origin: headers.Origin,
      Cookie: headers.cookie, Authorization: headers.authorization, 'X-Test': headers['X-Test'],
    });
    // '+' 是未转义标准 Base64 查询的边界情况，URLSearchParams 会把它变为空格。
    const withPlus = Buffer.from('{"X-Test":"~~~"}', 'utf8').toString('base64');
    expect(withPlus).toContain('+');
    const parsed = new URL('http://fixture/?headers=' + withPlus).searchParams.get('headers')!;
    expect(decodeProxyHeaders(parsed)).toEqual({ 'X-Test': '~~~' });
  });

  it('兼容 URL-safe Base64 与明文 JSON，并拒绝非法 headers', () => {
    const input = { Origin: 'https://example.test', 'X-Test': 'a+b/c=' };
    const encoded = Buffer.from(JSON.stringify(input), 'utf8').toString('base64url');
    expect(decodeProxyHeaders(encoded)).toEqual(input);
    expect(decodeProxyHeaders(JSON.stringify(input))).toEqual(input);
    expect(decodeProxyHeaders('not-json-or-base64')).toBeNull();
    expect(decodeProxyHeaders(Buffer.from('Referer:%ZZ', 'utf8').toString('base64'))).toBeNull();
    expect(decodeProxyHeaders('[]')).toBeNull();
    expect(decodeProxyHeaders('')).toEqual({});
  });

  it('过滤非法/连接管理头，并按大小写去重，显式 /play 参数优先', async () => {
    const dangerous = { ...headers, Host: 'other.example', Connection: 'close', 'Content-Length': '99',
      Range: 'bytes=99-', 'X-Invalid': 'bad\r\nInjected: yes', 'Bad Header': 'value' };
    const decoded = decodeProxyHeaders(JSON.stringify(dangerous))!;
    expect(decoded).not.toHaveProperty('Host');
    expect(decoded).not.toHaveProperty('Connection');
    expect(decoded).not.toHaveProperty('Content-Length');
    expect(decoded).not.toHaveProperty('Range');
    expect(decoded).not.toHaveProperty('X-Invalid');
    expect(decoded).not.toHaveProperty('Bad Header');
    const url = new URL(proxyBase + '/play');
    url.searchParams.set('url', upstreamBase + '/hls/media/seg-01.ts');
    url.searchParams.set('headers', JSON.stringify({ ...dangerous, 'user-agent': 'wrong', cookie: 'wrong', referer: 'wrong' }));
    url.searchParams.set('ua', headers['user-agent']);
    url.searchParams.set('cookie', headers.cookie);
    url.searchParams.set('referer', headers.referer);
    const response = await fetch(url);
    expect(response.status).toBe(200);
    await response.text();
    expect(seen[0].headers).toMatchObject(expectedHeaders);
  });

  it('额外请求头会沿清单 URI 进入分片 /play URL', () => {
    const output = rewriteM3u8WithHeaders(
      Buffer.from('#EXTM3U\nseg.ts\n'),
      'https://cdn.example/hls/index.m3u8',
      { 'User-Agent': 'UA', Origin: 'https://origin.example', Cookie: 'sid=1' },
    ).toString('utf8');
    const relay = output.split('\n')[1];
    const query = new URLSearchParams(relay.split('?')[1]);
    expect(query.get('ua')).toBe('UA');
    expect(query.get('cookie')).toBe('sid=1');
    expect(decodeProxyHeaders(query.get('headers') || '')).toEqual({ Origin: 'https://origin.example' });
  });

  it('非 HTTP key URI 保持原样，且相同文本前缀的外部地址不能误判成本中继', () => {
    const src = '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://fixture"\n' +
      'http://127.0.0.1:9978@cdn.example/seg.ts\n';
    const output = rewriteM3u8WithHeaders(Buffer.from(src), 'https://cdn.example/list', {}).toString('utf8');
    expect(output).toContain('URI="skd://fixture"');
    expect(new URL(output.split('\n')[2]).searchParams.get('url')).toBe('http://127.0.0.1:9978@cdn.example/seg.ts');
  });
});


describe('CatVod Adm3u8 Base64 manifest relay', () => {
  it('decodes the URL once and rewrites child playlists with the original headers', async () => {
    const encoded = Buffer.from(upstreamBase + '/playlist.m3u8').toString('base64');
    const url = proxyBase + '/proxy?do=Adm3u8&url=' + encodeURIComponent(encoded) + '&headers=' + encodeURIComponent(catvodHeaders(headers));
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('mpegurl');
    const text = await response.text();
    expect(text).toContain('#EXTM3U');
    const child = text.split('\n').find(line => line.startsWith('http'))!;
    expect(new URL(child).searchParams.get('url')).toBe(upstreamBase + '/hls/final/child.m3u8' + tokenQuery);
    const nested = await fetch(child);
    expect(nested.status).toBe(200);
    expect(await nested.text()).toContain('#EXT-X-KEY');
  });
  it.each(['not base64!', 'aW52YWxpZA==', 'ZmlsZTovLy9wcml2YXRl'])('rejects invalid or non-HTTP targets: %s', async encoded => {
    const before = seen.length;
    const response = await fetch(proxyBase + '/proxy?do=Adm3u8&url=' + encodeURIComponent(encoded));
    expect(response.status).toBe(400);
    await response.text();
    expect(seen).toHaveLength(before);
  });
});


it('merges player headers through a nested Adm3u8 Base64 relay', async () => {
  const inner = proxyBase + '/proxy?do=Adm3u8&url=' + encodeURIComponent(Buffer.from(upstreamBase + '/playlist.m3u8').toString('base64'));
  const outer = wrapPlayUrlWithHeaders(inner, headers).replace('http://127.0.0.1:9978', proxyBase);
  const response = await fetch(outer);
  expect(response.status).toBe(200);
  expect(await response.text()).toContain('#EXT-X-STREAM-INF');
  expect(seen.at(-1)?.headers).toMatchObject(expectedHeaders);
});

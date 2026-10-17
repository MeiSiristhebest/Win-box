// tests/configDecrypt.spec.ts
// ★ 2026-09-29：订阅「解密兜底」回归（用户口径：不做开关，用解密兜底）。
//   本模块两档：① 本地 base64/hex 解码（不联网）；② 第三方解密服务（只在①失败且地址可用时）。
import { describe, it, expect } from 'vitest';
import { createCipheriv } from 'node:crypto';
import type { HttpClient, HttpRequest, HttpResponse } from '../src/shared/types';
import { decodeLocalCipher, stripLineComments, tryDecryptConfig, REMOTE_DECRYPT_ENDPOINT } from '../src/main/net/configDecrypt';

const json = '{"sites":[{"key":"a","name":"A","api":"csp_A"}]}';

function cbcEnvelope(text: string, key = '1234567890123', iv = '1234567890123'): string {
  const cipher = createCipheriv('aes-128-cbc', Buffer.from(key.toLowerCase().padEnd(16, '0')), Buffer.from(iv.toLowerCase().padEnd(16, '0')));
  return Buffer.concat([Buffer.from('$#' + key + '#$'), cipher.update(text, 'utf8'), cipher.final(), Buffer.from(iv)]).toString('hex');
}

function fakeHttp(resp: Partial<HttpResponse> | Error, ok = true): { http: HttpClient; calls: HttpRequest[] } {
  const calls: HttpRequest[] = [];
  const http: HttpClient = {
    request: async (req: HttpRequest) => {
      calls.push(req);
      if (resp instanceof Error) throw resp;
      return { status: 200, headers: {}, content: '', finalUrl: req.url, ...resp } as HttpResponse;
    },
  };
  if (!ok) throw new Error('unused');
  return { http, calls };
}

describe('stripLineComments — 去掉 `//` 横幅', () => {
  it('该工具的返回会在正文前加 `//` 注释行', () => {
    const raw = '// >>> 当前时间是：2026-09-29 <<<\n// 关注公众号\n\n' + json;
    expect(stripLineComments(raw)).toBe(json);
    expect(JSON.parse(stripLineComments(raw))).toHaveProperty('sites');
  });

  it('空串/纯注释 → 空串', () => {
    expect(stripLineComments('')).toBe('');
    expect(stripLineComments('// a\n// b')).toBe('');
  });
});

describe('decodeLocalCipher — 本地编码优先（不联网）', () => {
  it('2423 CBC 封装携带 key/IV，本地还原中文订阅', () => {
    const text = '{"sites":[{"key":"玩偶","name":"中文源","api":"csp_Wogg"}]}';
    const envelope = cbcEnvelope(text, 'AbCd123', 'ABCD123456789');
    expect(decodeLocalCipher('// banner\n' + envelope.toUpperCase().match(/.{1,32}/g)!.join('\n'))).toEqual({ text, how: 'aes-cbc' });
  });

  it('CBC 缺标记、奇数 hex、无效块长、超长 key、坏 padding 或非订阅均拒绝', () => {
    const envelope = cbcEnvelope(json);
    const bytes = Buffer.from(envelope, 'hex');
    bytes[bytes.length - 14] ^= 0xff;
    for (const bad of [envelope.slice(1), envelope.slice(0, -2), '2423' + '00'.repeat(80), bytes.toString('hex'),
      cbcEnvelope('not a subscription'), '2423' + Buffer.from('x'.repeat(17) + '#$').toString('hex') + envelope.slice(34)]) {
      expect(decodeLocalCipher(bad)).toBeNull();
    }
  });
  it('整体 base64 的配置能解出（社区常见做法）', () => {
    const b64 = Buffer.from(json, 'utf-8').toString('base64');
    expect(decodeLocalCipher(b64)).toEqual({ text: json, how: 'base64' });
  });

  it('整体 hex 的配置能解出', () => {
    const hex = Buffer.from(json, 'utf-8').toString('hex');
    expect(decodeLocalCipher(hex)).toEqual({ text: json, how: 'hex' });
  });

  it('解出来不是订阅 JSON → 不认（交给下一档）', () => {
    const b64 = Buffer.from('hello world, not a config at all', 'utf-8').toString('base64');
    expect(decodeLocalCipher(b64)).toBeNull();
  });

  it('太短 / 普通 JSON → 不做解码尝试', () => {
    expect(decodeLocalCipher('aGVsbG8=')).toBeNull();
    expect(decodeLocalCipher(json)).toBeNull();
  });
});

describe('tryDecryptConfig — 两级兜底', () => {
  it('CBC 本地解开，不发送订阅地址给第三方', async () => {
    const { http, calls } = fakeHttp({ content: '' });
    expect(await tryDecryptConfig(http, 'https://a.b/sun.json', cbcEnvelope(json))).toEqual({ text: json, how: 'local-aes-cbc' });
    expect(calls).toHaveLength(0);
  });
  it('本地能解 → 直接用本地结果，**不请求第三方**', async () => {
    const { http, calls } = fakeHttp({ content: '' });
    const b64 = Buffer.from(json, 'utf-8').toString('base64');
    const r = await tryDecryptConfig(http, 'https://a.b/x.json', b64);
    expect(r).toEqual({ text: json, how: 'local-base64' });
    expect(calls.length).toBe(0); // 关键：本地解开就不外发
  });

  it('第三方解密请求接收并传播调用方取消信号', async () => {
    const controller = new AbortController();
    let observedSignal: AbortSignal | undefined;
    const http: HttpClient = {
      request: (req) => new Promise<HttpResponse>((_resolve, reject) => {
        observedSignal = req.signal;
        req.signal?.addEventListener('abort', () => reject(req.signal?.reason), { once: true });
      }),
    };
    const pending = tryDecryptConfig(http, 'https://a.b/enc.json', 'not-json', undefined, controller.signal);
    expect(observedSignal).toBe(controller.signal);
    controller.abort(new Error('subscription import cancelled'));
    await expect(pending).rejects.toThrow('subscription import cancelled');
  });

  it('本地解不出 → 走第三方解密服务，并剥掉 `//` 横幅', async () => {
    const { http, calls } = fakeHttp({ content: '// 时间\n// 公众号\n' + json });
    const r = await tryDecryptConfig(http, 'https://a.b/enc.json', '<html>拦截页</html>');
    expect(r?.how).toBe('remote-jiemi');
    expect(r?.text).toBe(json);
    expect(calls[0].url.startsWith(REMOTE_DECRYPT_ENDPOINT)).toBe(true);
    expect(calls[0].url).toContain(encodeURIComponent('https://a.b/enc.json'));
  });

  it('第三方回「解密失败」→ 返回 null（不抛）', async () => {
    const { http } = fakeHttp({ status: 500, content: '// 时间\n// 解密失败 请检查URL地址是否有误' });
    expect(await tryDecryptConfig(http, 'https://a.b/enc.json', 'x')).toBeNull();
  });

  it('第三方返回的不是订阅 JSON → 返回 null（不把垃圾当配置）', async () => {
    const { http } = fakeHttp({ content: '// 时间\n<html>广告页</html>' });
    expect(await tryDecryptConfig(http, 'https://a.b/enc.json', 'x')).toBeNull();
  });

  it('无 URL（粘贴导入）或请求异常 → 不炸，返回 null', async () => {
    const { http, calls } = fakeHttp({ content: json });
    expect(await tryDecryptConfig(http, '', 'not-json')).toBeNull();
    expect(calls.length).toBe(0);
    const { http: bad } = fakeHttp(new Error('ETIMEDOUT'));
    expect(await tryDecryptConfig(bad, 'https://a.b/enc.json', 'not-json')).toBeNull();
  });
});

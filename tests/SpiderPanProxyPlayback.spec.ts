import { describe, expect, it, vi } from 'vitest';
import type { PlayResult, SourceBean } from '../src/shared/types';
import {
  resolveSpiderPanProxyPlayback,
  type SpiderPanProxyPlaybackPorts,
} from '../src/main/spider/SpiderPanProxyPlayback';

const source = {} as SourceBean;

function playResult(url: string): PlayResult {
  return { url, parse: 0, playUrl: '', flag: 'main', jx: 0 } as PlayResult;
}

function ports(overrides: Partial<SpiderPanProxyPlaybackPorts> = {}): SpiderPanProxyPlaybackPorts {
  return {
    logger: { i: vi.fn(), w: vi.fn() },
    isBaiduDescriptor: vi.fn((url: string) => url.startsWith('{') && url.includes('"surl"')),
    baiduShareCode: vi.fn(() => 'share-code'),
    hasQuarkShare: vi.fn(() => false),
    proxyPortFor: vi.fn(() => 4321),
    probeSelfResolveUrl: vi.fn(async () => false),
    resolveBaidu: vi.fn(async (_url: string, _flag: string, failures: string[]) => {
      failures.push('百度：没有可用分享');
      return null;
    }),
    resolveUc: vi.fn(async (_url: string, _flag: string, failures: string[]) => {
      failures.push('UC：未绑定 UC 网盘 Cookie');
      return null;
    }),
    resolveQuark: vi.fn(async (_url: string, _flag: string, failures: string[]) => {
      failures.push('夸克：没有可用分享');
      return null;
    }),
    ...overrides,
  };
}

describe('resolveSpiderPanProxyPlayback', () => {
  it('leaves ordinary media URLs to the normal playback pipeline', async () => {
    const adapters = ports();
    const result = await resolveSpiderPanProxyPlayback(
      playResult('https://media.example/video.m3u8'),
      'source-a',
      'main',
      'episode-a',
      source,
      adapters,
    );

    expect(result).toBeNull();
    expect(adapters.proxyPortFor).not.toHaveBeenCalled();
    expect(adapters.resolveBaidu).not.toHaveBeenCalled();
  });

  it('prefers the source JVM proxy and returns it when its media probe succeeds', async () => {
    const adapters = ports({ probeSelfResolveUrl: vi.fn(async () => true) });
    const result = await resolveSpiderPanProxyPlayback(
      playResult('http://127.0.0.1:-1/proxy?do=pan&site=baidu&shareId=abc&fileId=123'),
      'source-a',
      'main',
      'episode-a',
      source,
      adapters,
    );

    expect(result?.url).toBe('http://127.0.0.1:9978/proxy/4321?do=pan&site=baidu&shareId=abc&fileId=123');
    expect(result?.parse).toBe(0);
    expect(adapters.resolveBaidu).not.toHaveBeenCalled();
    expect(adapters.resolveUc).not.toHaveBeenCalled();
    expect(adapters.resolveQuark).not.toHaveBeenCalled();
  });

  it('falls back in site-priority order and surfaces a missing account binding', async () => {
    const order: string[] = [];
    const adapters = ports({
      resolveUc: async (_url, _flag, failures) => {
        order.push('uc');
        failures.push('UC：未绑定 UC 网盘 Cookie');
        return null;
      },
      resolveBaidu: async (_url, _flag, failures) => {
        order.push('baidu');
        failures.push('百度：没有可用分享');
        return null;
      },
      resolveQuark: async (_url, _flag, failures) => {
        order.push('quark');
        failures.push('夸克：没有可用分享');
        return null;
      },
    });
    const result = await resolveSpiderPanProxyPlayback(
      playResult('http://127.0.0.1:-1/proxy?do=pan&site=uc&shareId=abc&fileId=episode'),
      'source-a',
      'main',
      'episode-a',
      source,
      adapters,
    );

    expect(order).toEqual(['uc', 'baidu', 'quark']);
    expect(result?.url).toBe('');
    expect(result?.needDriveCookieBind).toBe('uc');
    expect(result?.message).toContain('绑定UC网盘后');
  });

  it('synthesizes the JVM pan URL for a Baidu playback descriptor', async () => {
    const adapters = ports({ probeSelfResolveUrl: vi.fn(async () => true) });
    const descriptor = '{"surl":"share","share_id":"share-id","fs_id":"12345"}';
    const result = await resolveSpiderPanProxyPlayback(
      playResult(descriptor),
      'source-a',
      'main',
      'episode-a',
      source,
      adapters,
    );

    expect(adapters.probeSelfResolveUrl).toHaveBeenCalledWith(
      'http://127.0.0.1:9978/proxy/4321?do=pan&type=2&site=baidu&shareId=share-id&fileId=12345&fileToken=',
    );
    expect(result?.url).toContain('do=pan&type=2&site=baidu');
    expect(result?.parse).toBe(0);
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  needsHtmlMediaPreparation,
  prepareHtmlMediaSource,
  releaseHtmlMediaSession,
  type HtmlMediaPreparationPort,
} from '../src/renderer/features/playback/htmlMediaPreparation';

function portFor(target: string, payload?: unknown, status = 200): HtmlMediaPreparationPort {
  return {
    resolvePlayTarget: () => target,
    fetch: vi.fn(async () => new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })),
  };
}

describe('HTML media preparation', () => {
  it('only prepares proxied cloud-drive files, leaving direct and HLS URLs alone', () => {
    const eligible = portFor('https://drive.quark.cn/video.mp4');
    const direct = portFor('https://media.example/video.mp4');
    const hls = portFor('https://drive.quark.cn/video.m3u8');

    expect(needsHtmlMediaPreparation('http://127.0.0.1:19070/play?url=x', eligible)).toBe(true);
    expect(needsHtmlMediaPreparation('https://drive.quark.cn/video.mp4', eligible)).toBe(false);
    expect(needsHtmlMediaPreparation('http://127.0.0.1:19070/play?url=x', direct)).toBe(false);
    expect(needsHtmlMediaPreparation('http://127.0.0.1:19070/play?url=x', hls)).toBe(false);
  });

  it('returns direct sources without an IPC proxy request', async () => {
    const port = portFor('https://media.example/video.mp4');
    const signal = new AbortController().signal;
    const result = await prepareHtmlMediaSource('https://media.example/video.mp4', port, signal);

    expect(result).toEqual({ source: 'https://media.example/video.mp4', url: 'https://media.example/video.mp4' });
    expect(port.fetch).not.toHaveBeenCalled();
  });

  it('preserves dimensions and creates a release URL for a prepared session', async () => {
    const url = 'http://127.0.0.1:19070/play?url=x';
    const port = portFor('https://drive.quark.cn/video.mp4', { url: 'http://127.0.0.1:19070/html/session-1/master.m3u8', session: 'session-1', width: 3840, height: 2160 });
    const signal = new AbortController().signal;
    const result = await prepareHtmlMediaSource(url, port, signal);

    expect(result).toEqual({
      source: url,
      url: 'http://127.0.0.1:19070/html/session-1/master.m3u8',
      width: 3840,
      height: 2160,
      sessionReleaseUrl: 'http://127.0.0.1:19070/html/session-1/release',
    });
    expect(port.fetch).toHaveBeenCalledOnce();
    const [endpoint, options] = vi.mocked(port.fetch).mock.calls[0];
    expect(String(endpoint)).toContain('/html/prepare?url=');
    expect(options?.signal).toBe(signal);
  });

  it('rejects unsuccessful or incomplete preparation responses', async () => {
    const port = portFor('https://drive.quark.cn/video.mp4', { error: 'source rejected' }, 502);
    await expect(prepareHtmlMediaSource('http://127.0.0.1:19070/play?url=x', port, new AbortController().signal))
      .rejects.toThrow('source rejected');
  });

  it('releases sessions without waiting for the network', () => {
    const port = portFor('unused');
    releaseHtmlMediaSession('http://127.0.0.1:19070/html/session-1/release', port);

    expect(port.fetch).toHaveBeenCalledWith('http://127.0.0.1:19070/html/session-1/release', { keepalive: true });
  });
});

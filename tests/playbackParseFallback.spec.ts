import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_PROXY_BASE } from '../src/shared/constants';
import type { Logger, ParseBean, PlayResult } from '../src/shared/types';
import { PlaybackParseFallback, type PlaybackParseHit } from '../src/main/spider/PlaybackParseFallback';

const logger: Logger = { i: vi.fn(), w: vi.fn(), e: vi.fn() };
beforeEach(() => vi.clearAllMocks());
const parse = (overrides: Partial<ParseBean> = {}): ParseBean => ({
  name: 'parser',
  url: 'https://parser.example/?url=',
  ext: '',
  type: 0,
  ...overrides,
});
const result = (overrides: Partial<PlayResult> = {}): PlayResult => ({
  url: 'https://video.example/watch.html',
  parse: 1,
  playUrl: '',
  flag: '线路 A',
  jx: 0,
  ...overrides,
});

function createFallback(resolve: (parses: ParseBean[], target: string) => Promise<PlaybackParseHit | null>) {
  const parser = { resolve: vi.fn(resolve) };
  const fallback = new PlaybackParseFallback({ parser, logger });
  return { fallback, parser };
}

describe('PlaybackParseFallback', () => {
  it('passes through direct results without invoking parser I/O', async () => {
    const { fallback, parser } = createFallback(async () => null);
    const direct = result({ parse: 0, url: 'https://cdn.example/movie.mp4' });

    await expect(fallback.resolve(direct)).resolves.toBe(direct);
    expect(parser.resolve).not.toHaveBeenCalled();
  });

  it('resolves a watch page even when the spider incorrectly marks it as direct', async () => {
    const hit = { url: 'https://cdn.example/movie.m3u8', headers: {}, via: 'sniff:direct' };
    const { fallback, parser } = createFallback(async () => hit);
    const page = 'https://www.mgtv.com/592751.html';

    const resolved = await fallback.resolve(result({ parse: 0, url: page }));

    expect(parser.resolve).toHaveBeenCalledWith([], page);
    expect(resolved).toMatchObject({ parse: 0, url: `${LOCAL_PROXY_BASE}/play?url=${encodeURIComponent(hit.url)}` });
  });

  it('does not report an unresolved watch page as a successful direct result', async () => {
    const { fallback, parser } = createFallback(async () => null);
    const page = 'https://www.mgtv.com/592751.html';

    const unresolved = await fallback.resolve(result({ parse: 0, url: page }));

    expect(parser.resolve).toHaveBeenCalledWith([], page);
    expect(unresolved).toMatchObject({ parse: 1, url: page });
    expect(unresolved.message).toContain('自动解析未取得直连地址');
  });

  it('tries only the first address in a multi-address result', async () => {
    const hit = { url: 'https://cdn.example/movie.mp4', headers: {}, via: 'direct' };
    const { fallback, parser } = createFallback(async () => hit);
    const target = 'https://video.example/watch.html';

    const resolved = await fallback.resolve(result({ url: `${target}#https://other.example/video` }), [parse()]);

    expect(parser.resolve).toHaveBeenCalledWith([parse()], target);
    expect(resolved).toMatchObject({ parse: 0, url: hit.url, message: undefined });
  });

  it('relays parser headers through the local playback proxy', async () => {
    const { fallback } = createFallback(async () => ({
      url: 'https://cdn.example/movie.mp4',
      headers: { Referer: 'https://video.example/' },
      via: 'json:parser',
    }));

    const resolved = await fallback.resolve(result());

    expect(resolved.parse).toBe(0);
    expect(resolved.url).toContain(`${LOCAL_PROXY_BASE}/play?`);
    expect(resolved.url).toContain(encodeURIComponent('https://cdn.example/movie.mp4'));
    expect(logger.i).toHaveBeenCalledOnce();
  });

  it('relays a headerless HLS result so the player can load its segments', async () => {
    const { fallback } = createFallback(async () => ({
      url: 'https://cdn.example/master.m3u8',
      headers: {},
      via: 'sniff:direct',
    }));

    const resolved = await fallback.resolve(result());

    expect(resolved.parse).toBe(0);
    expect(resolved.url).toContain(`${LOCAL_PROXY_BASE}/play?`);
  });

  it('keeps parse-required state and gives an actionable message when no parser hits', async () => {
    const { fallback } = createFallback(async () => null);
    const unresolved = await fallback.resolve(result({ message: 'source message' }));

    expect(unresolved.parse).toBe(1);
    expect(unresolved.url).toBe('https://video.example/watch.html');
    expect(unresolved.message).toContain('自动解析未取得直连地址');
  });

  it('contains parser exceptions and preserves a visible unresolved result', async () => {
    const { fallback } = createFallback(async () => {
      throw new Error('sniffer unavailable');
    });
    const unresolved = await fallback.resolve(result());

    expect(unresolved.parse).toBe(1);
    expect(unresolved.message).toContain('自动解析未取得直连地址');
    expect(logger.w).toHaveBeenCalledWith('parse: 解析异常 sniffer unavailable');
  });
});

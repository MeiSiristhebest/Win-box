import { describe, expect, it } from 'vitest';
import { hlsErrorText } from '../src/renderer/features/playback/hlsErrorText';

describe('hlsErrorText', () => {
  it.each([
    ['manifestParsingError', '清单不是有效的 m3u8'],
    ['manifestLoadError', '清单加载失败'],
    ['levelLoadError', '清晰度清单加载失败'],
    ['fragLoadTimeOut', '分片加载失败'],
    ['bufferAppendError', '解码器不支持该视频编码'],
    ['bufferStalledError', '缓冲停滞'],
  ])('describes %s with an actionable message', (detail, expected) => {
    expect(hlsErrorText('networkError', detail)).toContain(expected);
  });

  it('keeps the engine type and detail for unclassified errors', () => {
    expect(hlsErrorText('networkError', 'unexpectedFailure')).toBe('networkError / unexpectedFailure');
    expect(hlsErrorText(undefined, undefined)).toBe('HLS / 未知错误');
  });

  it('shows an upstream HTTP status for failed manifest requests', () => {
    expect(hlsErrorText('networkError', 'manifestLoadError', 403)).toContain('HTTP 403');
  });

  it('distinguishes HTML login/interstitial pages from a failed HLS manifest', () => {
    expect(hlsErrorText('networkError', 'manifestLoadError', 200, '<!doctype html><html><title>Sign in</title></html>'))
      .toContain('HTML 网页而非 HLS 清单（HTTP 200）');
  });

  it('distinguishes a JSON API error body from an HLS manifest', () => {
    expect(hlsErrorText('networkError', 'manifestParsingError', 200, '{"error":"token expired"}'))
      .toContain('JSON 错误而非 HLS 清单（HTTP 200）');
  });

  it.each([
    [401, '要求登录或授权已过期'],
    [403, '拒绝访问'],
    [404, '不存在'],
    [429, '过于频繁'],
    [502, '暂时不可用'],
  ])('explains upstream HTTP %s without retrying it as a transient network error', (status, expected) => {
    expect(hlsErrorText('networkError', 'manifestLoadError', status)).toContain(expected);
  });
});

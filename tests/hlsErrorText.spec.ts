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
});

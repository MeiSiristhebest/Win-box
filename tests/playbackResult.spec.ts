import { describe, expect, it } from 'vitest';
import { directPlayUrlError, isErrorVideoUrl, playbackResultError } from '../src/shared/playbackResult';
import { extractParseResult, isMediaUrl } from '../src/main/parse/parseExtract';

describe('播放日志中的无效结果', () => {
  it.each(['', 'parse_api=8d112d1d&url=encrypted&token=|爱情怎么翻译|1', '12345', '{"fileId":"123"}', '/video/entry.mp4'])('拒绝空结果或源内参数：%s', url => {
    expect(directPlayUrlError(url)).not.toBe('');
    expect(playbackResultError({ parse: 0, url })).not.toBe('');
  });

  it.each(['/mizhicdn/video/error.mp4', 'https://cdn.test/mizhicdn/video/error.mp4?token=x',
    'http://127.0.0.1:9978/play?url=https%3A%2F%2Fcdn.test%2Fmizhicdn%2Fvideo%2Ferror.mp4'])('错误占位视频不能被解析或播放器判成功：%s', url => {
    expect(isErrorVideoUrl(url)).toBe(true);
    expect(directPlayUrlError(url)).toContain('错误占位视频');
    expect(isMediaUrl(url)).toBe(false);
    expect(extractParseResult(JSON.stringify({ url }))).toBeNull();
    expect(extractParseResult(url)).toBeNull();
  });

  it('rejects HTML watch pages as playable media URLs', () => {
    const url = 'https://www.mgtv.com/592751.html';
    expect(directPlayUrlError(url)).toContain('网页地址而非媒体流');
    expect(playbackResultError({ parse: 0, url })).toContain('网页地址而非媒体流');
  });

  it.each(['https://cdn.test/entry?token=a%2Bb', 'http://127.0.0.1:9978/bt/hash/1',
    'https://cdn.test/1.mp4#https://cdn.test/2.mp4', 'https://cdn.test/1.mp4#fragment',
    'file:///C:/Videos/a.mp4', 'C:\\Videos\\a.mp4', '\\\\server\\share\\a.mp4', 'rtsp://live.test/stream',
    'https://cdn.test/video/error.mp4'])('保留已有合法地址：%s', url => {
    expect(directPlayUrlError(url)).toBe('');
  });

  it('需解析和源端失败原因始终上屏', () => {
    expect(playbackResultError({ parse: 1, url: 'https://video.test/a.mp4' })).not.toBe('');
    expect(playbackResultError({ parse: 0, url: '', message: '源站接口暂不可用' })).toBe('源站接口暂不可用');
  });
});


describe('CMS preferred playback line', () => {
  it('classifies share/play pages while preserving media and opaque direct URLs', async () => {
    const { isPlaybackPageUrl } = await import('../src/shared/playbackResult');
    expect(isPlaybackPageUrl('https://cdn.test/play/abc')).toBe(true);
    expect(isPlaybackPageUrl('https://cdn.test/share/abc')).toBe(true);
    expect(isPlaybackPageUrl('https://cdn.test/play/abc/index.m3u8')).toBe(false);
    expect(isPlaybackPageUrl('https://cdn.test/opaque-signature?token=x')).toBe(false);
  });
  it('chooses the direct HLS line when the first line is a player page', async () => {
    const { preferredPlaybackFlag } = await import('../src/shared/playbackResult');
    expect(preferredPlaybackFlag({ flags: ['hnyun', 'hnm3u8'], episodes: {
      hnyun: [{ name: '1', url: 'https://cdn.test/play/abc' }],
      hnm3u8: [{ name: '1', url: 'https://cdn.test/play/abc/index.m3u8' }],
    } })).toBe('hnm3u8');
  });
  it('preserves spider-defined and opaque first lines', async () => {
    const { preferredPlaybackFlag } = await import('../src/shared/playbackResult');
    expect(preferredPlaybackFlag({ flags: ['native', 'hls'], episodes: {
      native: [{ name: '1', url: 'native-episode-id' }],
      hls: [{ name: '1', url: 'https://cdn.test/index.m3u8' }],
    } })).toBe('native');
  });
});

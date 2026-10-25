import { describe, expect, it, vi } from 'vitest';
import {
  openConfiguredExternalFallback,
  playVodExternal,
  type ExternalPlaybackPorts,
  type VodExternalPlayInput,
} from '../src/renderer/features/playback/externalPlayback';
import type { MediaKind } from '../src/renderer/lib/mediaKind';

const input: VodExternalPlayInput = {
  key: 'source-1',
  flag: 'playlist',
  rawUrl: 'episode://raw-id',
  display: '示例影片 - 第01集',
  pic: 'https://img.example/poster.jpg',
  remarks: '第01集',
  sourceName: '示例源',
  vodId: 'movie-1',
  seek: 75,
};

function makePorts(overrides: Partial<ExternalPlaybackPorts> = {}): ExternalPlaybackPorts {
  return {
    getPreferences: vi.fn(async () => ({ vodExternalPlayerEnabled: true, vodExternalPlayer: 'D:\\PotPlayer\\PotPlayerMini64.exe' })),
    getActiveProfileId: vi.fn(async () => 'profile-1'),
    resolvePlayback: vi.fn(async () => ({ url: 'https://media.example/video.m3u8', parse: 0 })),
    openExternal: vi.fn(async () => ({ ok: true, player: 'PotPlayer' })),
    classifyMedia: vi.fn((): MediaKind => 'hls'),
    recordWatch: vi.fn(),
    persistHistory: vi.fn(),
    ...overrides,
  };
}

describe('playVodExternal use case', () => {
  it('keeps playback in the app when external playback is disabled', async () => {
    const ports = makePorts({ getPreferences: vi.fn(async () => ({ vodExternalPlayerEnabled: false })) });

    await expect(playVodExternal(input, ports)).resolves.toEqual({ played: false });
    expect(ports.resolvePlayback).not.toHaveBeenCalled();
  });

  it('reports enabled configuration without a player path', async () => {
    const ports = makePorts({ getPreferences: vi.fn(async () => ({ vodExternalPlayerEnabled: true })) });

    await expect(playVodExternal(input, ports)).resolves.toMatchObject({ played: false, error: expect.stringContaining('没有配置播放器路径') });
    expect(ports.resolvePlayback).not.toHaveBeenCalled();
  });

  it('does not bypass app-only drive authorization or web parsing', async () => {
    const drivePorts = makePorts({ resolvePlayback: vi.fn(async () => ({ needDriveCookieBind: 'quark' })) });
    await expect(playVodExternal(input, drivePorts)).resolves.toMatchObject({ played: false, fallbackReason: expect.stringContaining('网盘授权') });

    const parsePorts = makePorts({ resolvePlayback: vi.fn(async () => ({ url: 'https://media.example/watch', parse: 1 })) });
    await expect(playVodExternal(input, parsePorts)).resolves.toMatchObject({ played: false, fallbackReason: expect.stringContaining('网页解析器') });
    expect(drivePorts.openExternal).not.toHaveBeenCalled();
    expect(parsePorts.openExternal).not.toHaveBeenCalled();
  });

  it('does not send images or unsupported protocols to an external video player', async () => {
    const imagePorts = makePorts({ classifyMedia: vi.fn((): MediaKind => 'image') });
    const unsupportedPorts = makePorts({ classifyMedia: vi.fn((): MediaKind => 'unsupported') });

    await expect(playVodExternal(input, imagePorts)).resolves.toMatchObject({ played: false, fallbackReason: expect.stringContaining('不是 PotPlayer') });
    await expect(playVodExternal(input, unsupportedPorts)).resolves.toMatchObject({ played: false, fallbackReason: expect.stringContaining('不是 PotPlayer') });
    expect(imagePorts.openExternal).not.toHaveBeenCalled();
    expect(unsupportedPorts.openExternal).not.toHaveBeenCalled();
  });

  it('resolves, launches, and records the original episode using injected ports', async () => {
    const ports = makePorts();

    await expect(playVodExternal(input, ports)).resolves.toEqual({ played: true, player: 'PotPlayer' });
    expect(ports.resolvePlayback).toHaveBeenCalledWith({ key: 'source-1', flag: 'playlist', id: 'episode://raw-id', profileId: 'profile-1' });
    expect(ports.openExternal).toHaveBeenCalledWith('https://media.example/video.m3u8', 75);
    expect(ports.recordWatch).toHaveBeenCalledWith({
      url: 'episode://raw-id',
      rawUrl: 'episode://raw-id',
      flag: 'playlist',
      name: '示例影片 - 第01集',
      pic: 'https://img.example/poster.jpg',
      remarks: '第01集',
      sourceName: '示例源',
      sourceKey: 'source-1',
      profileId: 'profile-1',
      vodId: 'movie-1',
    });
    expect(ports.persistHistory).toHaveBeenCalledOnce();
  });

  it('does not write history when launch fails', async () => {
    const ports = makePorts({ openExternal: vi.fn(async () => ({ ok: false, error: '播放器启动失败' })) });

    await expect(playVodExternal(input, ports)).resolves.toEqual({ played: false, error: '播放器启动失败' });
    expect(ports.recordWatch).not.toHaveBeenCalled();
    expect(ports.persistHistory).not.toHaveBeenCalled();
  });
});

describe('openConfiguredExternalFallback', () => {
  it('does not start a player when the setting is off', async () => {
    const ports = makePorts({ getPreferences: vi.fn(async () => ({ vodExternalPlayerEnabled: false })) });

    await expect(openConfiguredExternalFallback('https://media.example/video.mp4', 12, ports)).resolves.toBeNull();
    expect(ports.openExternal).not.toHaveBeenCalled();
  });

  it('opens an already resolved stream and preserves the playback position', async () => {
    const ports = makePorts();

    await expect(openConfiguredExternalFallback('https://media.example/video.mp4', 12, ports)).resolves.toEqual({ opened: true, player: 'PotPlayer' });
    expect(ports.openExternal).toHaveBeenCalledWith('https://media.example/video.mp4', 12);
  });
});

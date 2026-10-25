import { describe, expect, it, vi } from 'vitest';
import { resolveDetailEpisodePlayback } from '../src/renderer/features/detail/application/detailPlaybackUseCase';
import type { DetailPlaybackPort } from '../src/renderer/features/detail/application/detailPlaybackPorts';
import type { PlayResult } from '../src/shared/types';

const result = (overrides: Partial<PlayResult> = {}): PlayResult => ({
  parse: 0, url: 'https://media.example/video.m3u8', playUrl: '', flag: 'main', ...overrides,
});

describe('resolveDetailEpisodePlayback', () => {
  it('returns a binding outcome and avoids treating it as a playback error', async () => {
    const port: DetailPlaybackPort = {
      play: vi.fn(async () => result({ needDriveCookieBind: 'quark' })),
      rememberSelection: vi.fn(),
      persistSelection: vi.fn(),
    };
    await expect(resolveDetailEpisodePlayback({ key: 's', flag: 'main', episodeUrl: 'e', profileId: 'p' }, port))
      .resolves.toEqual({ kind: 'needs-drive-binding', provider: 'quark' });
  });

  it('normalizes source playback errors', async () => {
    const port: DetailPlaybackPort = {
      play: vi.fn(async () => result({ parse: 1, url: '', message: 'source returned no media' })),
      rememberSelection: vi.fn(),
      persistSelection: vi.fn(),
    };
    await expect(resolveDetailEpisodePlayback({ key: 's', flag: 'main', episodeUrl: 'e', profileId: 'p' }, port))
      .resolves.toMatchObject({ kind: 'failed', message: 'source returned no media' });
  });

  it('requires a resolved profile and does not call the playback adapter without one', async () => {
    const port: DetailPlaybackPort = {
      play: vi.fn(async () => result()),
      rememberSelection: vi.fn(),
      persistSelection: vi.fn(),
    };
    await expect(resolveDetailEpisodePlayback({ key: 's', flag: 'main', episodeUrl: 'e', profileId: '' }, port))
      .resolves.toEqual({ kind: 'failed', message: '详情页尚未确定所属订阅' });
    expect(port.play).not.toHaveBeenCalled();
  });
});

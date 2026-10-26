import { describe, expect, it } from 'vitest';
import type HlsInstance from 'hls.js';
import { createHlsAudioTrackControllerAdapter } from '../src/renderer/features/playback/adapters/hlsAudioTrackControllerAdapter';

describe('createHlsAudioTrackControllerAdapter', () => {
  it('maps HLS tracks to the shared playback model and selects by track index', () => {
    const hls = {
      audioTrack: 1,
      audioTracks: [
        { name: '国语', lang: 'chi', attrs: { CHANNELS: '2' } },
        { name: '日本語', lang: 'jpn', attrs: { CHANNELS: '6' } },
      ],
    } as unknown as HlsInstance;

    const controller = createHlsAudioTrackControllerAdapter(hls);

    expect(controller.read()).toEqual({
      tracks: [
        { id: 0, title: '国语', lang: 'chi', channels: '2', selected: undefined },
        { id: 1, title: '日本語', lang: 'jpn', channels: '6', selected: true },
      ],
      selectedTrackId: 1,
    });

    controller.select(0);
    expect(hls.audioTrack).toBe(0);
    expect(controller.read().tracks[0].selected).toBe(true);
  });

  it('reports no selected track when the HLS engine has not selected one', () => {
    const hls = { audioTrack: -1, audioTracks: [] } as unknown as HlsInstance;

    expect(createHlsAudioTrackControllerAdapter(hls).read()).toEqual({ tracks: [], selectedTrackId: null });
  });
});

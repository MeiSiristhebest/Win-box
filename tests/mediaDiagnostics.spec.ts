import { describe, expect, it } from 'vitest';
import { createHtmlMediaDiagnosticEvent } from '../src/renderer/features/playback/application/mediaDiagnostics';

describe('HTML media diagnostic mapping', () => {
  it('creates a serializable snapshot independent from DOM and IPC', () => {
    expect(createHtmlMediaDiagnosticEvent({
      event: 'waiting',
      url: 'https://media.example/video.mp4?token=private',
      title: 'Episode 1',
      readyState: 2,
      currentTime: 18.5,
      paused: false,
    })).toEqual({
      event: 'waiting',
      kernel: 'html5',
      url: 'https://media.example/video.mp4?token=private',
      title: 'Episode 1',
      readyState: 2,
      currentTime: 18.5,
      paused: false,
    });
  });
});

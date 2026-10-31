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

  it('preserves concise media failure details for the main-process diagnostic boundary', () => {
    expect(createHtmlMediaDiagnosticEvent({
      event: 'error',
      url: 'http://127.0.0.1/play?url=private',
      readyState: 0,
      currentTime: 0,
      paused: true,
      mediaErrorCode: 4,
      networkState: 3,
      mediaErrorMessage: 'MEDIA_ELEMENT_ERROR: Format error',
    })).toMatchObject({
      event: 'error',
      mediaErrorCode: 4,
      networkState: 3,
      mediaErrorMessage: 'MEDIA_ELEMENT_ERROR: Format error',
    });
  });
});

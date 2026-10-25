import type { PlaybackRuntimePort } from '../application/playbackSessionPorts';

export const playerPlaybackRuntimeAdapter: PlaybackRuntimePort = {
  isDesktopRuntime: () => typeof window.api !== 'undefined',
};

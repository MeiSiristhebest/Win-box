import { isNativeModalOpen } from '../../../lib/modalScope';
import type { AudioPlayerShortcutGuardPort } from '../application/audioPlayerPorts';

export const audioPlayerShortcutGuardAdapter: AudioPlayerShortcutGuardPort = {
  shouldIgnoreAudioPlaybackShortcuts: isNativeModalOpen,
};

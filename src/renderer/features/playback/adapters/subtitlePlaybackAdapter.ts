import type { MpvCommand } from '../../../../shared/player';
import { client } from '../../../api/client';
import { isEngineKernel } from '../../../lib/kernel';
import type { NativeSubtitleKernel, SubtitlePlaybackPort } from '../application/subtitlePlaybackPort';
import { playerViewportAdapter } from './playerViewportAdapter';

export const subtitlePlaybackAdapter: SubtitlePlaybackPort = {
  loadSettings: () => client.subtitleGet(),
  saveSettings: (patch) => client.subtitleSet(patch),
  sendKernelCommand: (kernel: NativeSubtitleKernel, command: MpvCommand) =>
    isEngineKernel(kernel) ? client.engineCmd(command) : client.mpvCmd(command),
  viewportHeight: () => playerViewportAdapter.viewport().height,
};

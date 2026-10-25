import { client } from '../../../api/client';
import type { PlaybackKernelSessionPort, MpvStatusQueryPort } from '../application/mpvPlaybackPorts';

export const mpvPlaybackSessionAdapter: PlaybackKernelSessionPort = {
  mpvOnState: (callback) => client.mpvOnState(callback),
  mpvStart: (options) => client.mpvStart(options),
  mpvCmd: (command) => client.mpvCmd(command),
  mpvStop: () => client.mpvStop(),
  engineOnState: (callback) => client.engineOnState(callback),
  engineStart: (options) => client.engineStart(options),
  engineCmd: (command) => client.engineCmd(command),
  engineStop: () => client.engineStop(),
};

export const mpvStatusQueryAdapter: MpvStatusQueryPort = {
  getStatus: () => client.mpvStatus(),
};

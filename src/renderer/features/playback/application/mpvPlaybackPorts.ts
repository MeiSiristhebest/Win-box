import type { MpvCommand, MpvStartOptions, MpvStateEvent, MpvStatus } from '../../../../shared/player';

export interface MpvPlaybackSessionPort {
  mpvOnState(callback: (state: MpvStateEvent) => void): () => void;
  mpvStart(options: MpvStartOptions): Promise<{ session: number }>;
  mpvCmd(command: MpvCommand): Promise<unknown>;
  mpvStop(): Promise<unknown>;
}

/** A plugin engine is selectable only when it can report state, accept commands, and stop. */
export interface PluginPlaybackSessionPort {
  engineOnState(callback: (state: MpvStateEvent) => void): () => void;
  engineStart(options: MpvStartOptions & { engineId: string }): Promise<{ ok: boolean; session?: number; reason?: string }>;
  engineCmd(command: MpvCommand): Promise<unknown>;
  engineStop(): Promise<unknown>;
}

/** The kernel session coordinator switches between these two complete runtime contracts. */
export type PlaybackKernelSessionPort = MpvPlaybackSessionPort & PluginPlaybackSessionPort;

export interface MpvStatusQueryPort {
  getStatus(): Promise<MpvStatus>;
}

import type { MpvCommand } from '../../../../shared/player';

export interface PlayerWindowControlMessage {
  op: string;
  value?: unknown;
}

export type PlayerWindowControlAction =
  | { type: 'selectEpisode'; index: number }
  | { type: 'sendMpvCommand'; command: MpvCommand };

export interface PlayerWindowControlEventsPort {
  subscribe(onControl: (message: PlayerWindowControlMessage) => void): () => void;
}

export interface PlayerMpvCommandPort {
  sendMpvCommand(command: MpvCommand): Promise<unknown>;
}

/** Purely translates plugin window controls into an episode selection or a player command. */
export function resolvePlayerWindowControl(
  message: PlayerWindowControlMessage,
  currentEpisodeIndex: number,
  episodeCount: number,
): PlayerWindowControlAction | null {
  if (message.op === 'next') {
    const index = currentEpisodeIndex + 1;
    return index < episodeCount ? { type: 'selectEpisode', index } : null;
  }
  if (message.op === 'prev') {
    const index = currentEpisodeIndex - 1;
    return index >= 0 ? { type: 'selectEpisode', index } : null;
  }
  if (message.op === 'play' || message.op === 'pause') {
    return { type: 'sendMpvCommand', command: { type: message.op } };
  }

  const value = typeof message.value === 'number' ? message.value : Number(message.value);
  if (!Number.isFinite(value)) return null;

  switch (message.op) {
    case 'seek':
    case 'volume':
      return { type: 'sendMpvCommand', command: { type: message.op, value } };
    case 'audioTrack':
      return { type: 'sendMpvCommand', command: { type: 'aid', value } };
    case 'subtitle':
      return { type: 'sendMpvCommand', command: { type: 'sid', value } };
    default:
      return null;
  }
}

import { useEffect, useLayoutEffect, useRef } from 'react';
import { resolvePlayerWindowControl } from './application/playerWindowControl';
import type {
  PlayerMpvCommandPort,
  PlayerWindowControlEventsPort,
} from './application/playerWindowControl';

interface PlayerWindowControlsOptions {
  events: PlayerWindowControlEventsPort;
  commands: PlayerMpvCommandPort;
  currentEpisodeIndex: number;
  episodeCount: number;
  onSelectEpisode: (index: number) => void;
}

/** Subscribes to remote window controls and forwards normalized actions to playback. */
export function usePlayerWindowControls({
  events,
  commands,
  currentEpisodeIndex,
  episodeCount,
  onSelectEpisode,
}: PlayerWindowControlsOptions): void {
  const latest = useRef({ currentEpisodeIndex, episodeCount, onSelectEpisode });

  useLayoutEffect(() => {
    latest.current = { currentEpisodeIndex, episodeCount, onSelectEpisode };
  }, [currentEpisodeIndex, episodeCount, onSelectEpisode]);

  useEffect(() => events.subscribe((message) => {
    const current = latest.current;
    const action = resolvePlayerWindowControl(message, current.currentEpisodeIndex, current.episodeCount);
    if (!action) return;
    if (action.type === 'selectEpisode') {
      current.onSelectEpisode(action.index);
      return;
    }
    void commands.sendMpvCommand(action.command).catch(() => undefined);
  }), [commands, events]);
}

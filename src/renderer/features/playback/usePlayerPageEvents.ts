import { useEffect, useLayoutEffect, useRef } from 'react';
import { acceptInitSeq } from '../../lib/staleGuard';
import type { PlayerInitData, PlayerPageEventsPort } from './application/playerPageSession';

export interface PlayerPageEventHandlers {
  applyInit(data: PlayerInitData): void;
  selectEpisode(index: number): void;
}

/** Owns the player-window event subscriptions and rejects duplicate/late init messages. */
export function usePlayerPageEvents(
  port: PlayerPageEventsPort,
  handlers: PlayerPageEventHandlers,
): void {
  const latest = useRef(handlers);
  const latestSequence = useRef(0);

  useLayoutEffect(() => {
    latest.current = handlers;
  }, [handlers]);

  useEffect(() => {
    const offInit = port.onInit((incoming) => {
      if (!acceptInitSeq(latestSequence.current, incoming.initSeq)) return;
      latestSequence.current = Math.max(latestSequence.current, Number(incoming.initSeq) || 0);
      latest.current.applyInit(incoming);
    });
    const offSwitch = port.onEpisodeSwitch((index) => latest.current.selectEpisode(index));
    void port.ready().catch(() => undefined);
    return () => {
      offInit();
      offSwitch();
    };
  }, [port]);
}

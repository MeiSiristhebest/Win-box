import { useCallback, useEffect, useMemo, useReducer } from 'react';
import type { PlaybackRecoveryCause, PlayerPageHistoryPort, PlayerPageSessionPort, PlayerSourceMemoryPort, PlayerInitData } from './application/playerPageSession';
import { createPlayerPageSessionWorkflow } from './application/playerPageSessionWorkflow';
import { usePlayerPageEvents } from './usePlayerPageEvents';
import { usePlayerHistoryProgress } from './usePlayerHistoryProgress';
import {
  initialPlayerPageSessionState,
  presentPlayerPageSession,
  reducePlayerPageSession,
} from './application/playerPageSessionState';
import type { PlayerPageSessionPresentation } from './application/playerPageSessionState';

export interface PlayerPageSession extends PlayerPageSessionPresentation {
  episodes: PlayerInitData['episodes'];
  canPrev: boolean;
  canNext: boolean;
  selectEpisode(index: number): void;
  retryCurrent(): void;
  autoChangeParse(currentPosition?: number, reason?: string, cause?: PlaybackRecoveryCause): Promise<boolean>;
  selectAlternative(id: string): boolean;
  confirmPlaybackStarted(): void;
  dismissDriveBinding(): void;
  onDriveBound(): void;
}

export function usePlayerPageSession(
  sessionPort: PlayerPageSessionPort,
  historyPort: PlayerPageHistoryPort,
  sourceMemory: PlayerSourceMemoryPort,
): PlayerPageSession {
  const [state, dispatch] = useReducer(reducePlayerPageSession, initialPlayerPageSessionState);
  const { init, epIndex, activeUrl, curName, resolving, driveBind, parseMsg, playName, parseName, sourceFallback } = presentPlayerPageSession(state);
  const workflow = useMemo(() => createPlayerPageSessionWorkflow({
    session: sessionPort,
    history: historyPort,
    sourceMemory,
    publish: dispatch,
  }), [historyPort, sessionPort, sourceMemory]);

  useEffect(() => {
    workflow.begin();
    return () => workflow.dispose();
  }, [workflow]);

  usePlayerPageEvents(sessionPort, workflow);

  const episodes = init?.episodes || [];
  const canPrev = Boolean(init && epIndex > 0);
  const canNext = Boolean(init && epIndex < episodes.length - 1);

  const retryCurrent = useCallback(() => workflow.retryCurrent(state.resolution.kind), [state.resolution.kind, workflow]);
  const onDriveBound = useCallback(() => workflow.onDriveBound(state.resolution.kind), [state.resolution.kind, workflow]);

  usePlayerHistoryProgress(init && !init.deferHistoryUntilPlayback ? {
    rawUrl: init.episodes?.[epIndex]?.url || '',
    playbackUrl: activeUrl,
    name: curName || init.lastName || '',
    flag: init.flag,
    sourceName: init.meta?.sourceName,
    sourceKey: init.meta?.fromKey || init.key || '',
    profileId: init.meta?.profileId,
    vodId: init.meta?.vodId ?? init.meta?.id,
    pic: init.meta?.pic,
    episodeName: init.episodes?.[epIndex]?.name,
  } : null, historyPort);

  return {
    init,
    epIndex,
    activeUrl,
    curName,
    playName,
    resolving,
    driveBind,
    parseMsg,
    parseName,
    sourceFallback,
    episodes,
    canPrev,
    canNext,
    selectEpisode: workflow.selectEpisode,
    retryCurrent,
    autoChangeParse: workflow.autoChangeParse,
    selectAlternative: workflow.selectAlternative,
    confirmPlaybackStarted: workflow.confirmPlaybackStarted,
    dismissDriveBinding: workflow.dismissDriveBinding,
    onDriveBound,
  };
}

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { formatEpisodeLabel } from '../../lib/epName';
import { makeStaleGuard } from '../../lib/staleGuard';
import { playbackResultError } from '../../../shared/playbackResult';
import { hydratePlayerInit } from './application/hydratePlayerInit';
import type { PlayerPageHistoryPort, PlayerPageSessionPort, PlayerSourceMemoryPort, PlayerInitData } from './application/playerPageSession';
import { resolvePlayerPlayback } from './application/resolvePlayerPlayback';
import { recordOpenedPlayerEpisode } from './application/recordPlayerEpisode';
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
  autoChangeParse(currentPosition?: number): Promise<boolean>;
  dismissDriveBinding(): void;
  onDriveBound(): void;
}

export function usePlayerPageSession(
  sessionPort: PlayerPageSessionPort,
  historyPort: PlayerPageHistoryPort,
  sourceMemory: PlayerSourceMemoryPort,
): PlayerPageSession {
  const [state, dispatch] = useReducer(reducePlayerPageSession, initialPlayerPageSessionState);
  const { init, epIndex, activeUrl, curName, resolving, driveBind, parseMsg, playName, parseName } = presentPlayerPageSession(state);
  const initRef = useRef<PlayerInitData | null>(null);
  const pendingInitRef = useRef<PlayerInitData | null>(null);
  const resolveGeneration = useRef(makeStaleGuard());
  const parseOffsetRef = useRef(0);

  const updateInit = useCallback((next: PlayerInitData) => {
    initRef.current = next;
    dispatch({ type: 'init-updated', init: next });
  }, []);

  useEffect(() => {
    historyPort.beginPlayerHistorySession();
  }, [historyPort]);

  const resolve = useCallback(async (data: PlayerInitData, index: number, preparedUrl = '', options?: { parseOffset?: number }) => {
    const episodes = data.episodes;
    if (!episodes || index < 0 || index >= episodes.length) return;
    const target = episodes[index];
    const generation = resolveGeneration.current.next();
    const mainTitle = (data.subtitleTitle || data.title || '').trim();
    const episodeLabel = formatEpisodeLabel(target.name, index);
    const displayName = mainTitle ? `${mainTitle} - ${episodeLabel}` : episodeLabel;

    dispatch({ type: 'resolution-started', epIndex: index, curName: displayName, playName: mainTitle });

    try {
      const result = await resolvePlayerPlayback(data, index, preparedUrl, sessionPort, options);
      if (!resolveGeneration.current.isCurrent(generation)) return;
      if (result.needDriveCookieBind) {
        dispatch({ type: 'drive-bind-required', provider: result.needDriveCookieBind });
        return;
      }
      const error = playbackResultError(result);
      if (error) {
        dispatch({ type: 'resolution-failed', message: error });
        return;
      }
      dispatch({ type: 'resolution-succeeded', url: result.url, parseName: result.parseName });
    } catch (error) {
      if (!resolveGeneration.current.isCurrent(generation)) return;
      dispatch({ type: 'resolution-failed', message: error instanceof Error ? error.message : String(error) });
      return;
    }

    recordOpenedPlayerEpisode({ data, index, displayName, episodeLabel }, historyPort, sourceMemory);
  }, [historyPort, sessionPort, sourceMemory]);

  const applyInit = useCallback(async (incoming: PlayerInitData) => {
    const generation = resolveGeneration.current.next();
    pendingInitRef.current = incoming;
    initRef.current = null;
    dispatch({ type: 'hydration-started' });

    let data: PlayerInitData;
    try {
      const hydrated = await hydratePlayerInit(incoming, sessionPort, () => resolveGeneration.current.isCurrent(generation));
      if (!hydrated) return;
      data = hydrated;
    } catch (error) {
      if (!resolveGeneration.current.isCurrent(generation)) return;
      dispatch({ type: 'hydration-failed', message: error instanceof Error ? error.message : String(error) });
      return;
    }

    if (!resolveGeneration.current.isCurrent(generation)) return;
    pendingInitRef.current = null;
    updateInit(data);
    const index = Math.max(0, Math.min(data.epIndex || 0, (data.episodes?.length || 1) - 1));
    dispatch({ type: 'hydration-completed', init: data, epIndex: index });
    if (data.episodes.length === 0) return;
    void resolve(data, index, data.lastUrl);
  }, [resolve, sessionPort, updateInit]);

  const selectEpisode = useCallback((index: number) => {
    parseOffsetRef.current = 0;
    const current = initRef.current;
    if (!current || !Number.isInteger(index) || index < 0 || index >= current.episodes.length) return;
    const next = { ...current, startTime: 0, lastUrl: '', epIndex: index };
    updateInit(next);
    void resolve(next, index);
  }, [resolve, updateInit]);

  usePlayerPageEvents(sessionPort, { applyInit, selectEpisode });

  useEffect(() => () => {
    resolveGeneration.current.next();
    pendingInitRef.current = null;
    initRef.current = null;
    void sessionPort.cleanupTemporaryFiles().catch(() => undefined);
  }, [sessionPort]);

  const episodes = init?.episodes || [];
  const canPrev = Boolean(init && epIndex > 0);
  const canNext = Boolean(init && epIndex < episodes.length - 1);

  const retryCurrent = useCallback(() => {
    if (state.resolution.kind === 'hydrating' || state.resolution.kind === 'resolving') return;
    const pendingInit = pendingInitRef.current;
    if (pendingInit) {
      parseOffsetRef.current = 0;
      void applyInit(pendingInit);
      return;
    }
    const current = initRef.current;
    if (current) void resolve(current, epIndex, '', { parseOffset: parseOffsetRef.current });
  }, [applyInit, epIndex, resolve, state.resolution.kind]);

  const autoChangeParse = useCallback(async (currentPosition?: number): Promise<boolean> => {
    const current = initRef.current;
    if (!current) return false;
    parseOffsetRef.current += 1;
    const nextInit: PlayerInitData = currentPosition != null && currentPosition > 0
      ? { ...current, startTime: currentPosition }
      : current;
    updateInit(nextInit);
    await resolve(nextInit, epIndex, '', { parseOffset: parseOffsetRef.current });
    return true;
  }, [epIndex, resolve, updateInit]);

  const dismissDriveBinding = useCallback(() => dispatch({ type: 'drive-bind-dismissed' }), []);
  const onDriveBound = useCallback(() => {
    dispatch({ type: 'drive-bind-dismissed' });
    retryCurrent();
  }, [retryCurrent]);

  usePlayerHistoryProgress(init ? {
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
    episodes,
    canPrev,
    canNext,
    selectEpisode,
    retryCurrent,
    autoChangeParse,
    dismissDriveBinding,
    onDriveBound,
  };
}

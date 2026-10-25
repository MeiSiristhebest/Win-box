import { useCallback, useEffect, useRef, useState } from 'react';
import type { EpgProgram, LiveBean, LiveEpgEntry, LiveGroup, UserConfig } from '../../../shared/types';
import { splitLine } from '../../../engine/live/LiveUtils';
import { buildCatchupUrl } from '../../../engine/live/catchup';
import type {
  LivePlaybackClockPort,
  LivePlaybackDataPort,
  LivePlaybackRefreshPort,
  LiveSelectionMemoryPort,
} from './application/livePlaybackPorts';
import { liveSelectionMemoryKey } from './application/livePlaybackPorts';
import { selectLiveChannel } from './application/liveChannelSelection';

interface LiveView {
  profileId: string; lives: LiveBean[]; liveIdx: number; groups: LiveGroup[];
  groupName: string; channelName: string; lineIdx: number; playUrl: string; liveName: string;
  loading: boolean; err: string;
}
const EMPTY: LiveView = { profileId: '', lives: [], liveIdx: 0, groups: [], groupName: '', channelName: '', lineIdx: 0, playUrl: '', liveName: '', loading: false, err: '' };
function specKey(config: UserConfig, index: number): string {
  return JSON.stringify([config.activeProfileId, config.lives, index]);
}

export interface LivePlaybackDependencies {
  data: LivePlaybackDataPort;
  memory: LiveSelectionMemoryPort;
  refresh: LivePlaybackRefreshPort;
  clock: LivePlaybackClockPort;
}

/** Live metadata, playback selection and request lifetime belong to the same profile snapshot. */
export function useLivePlayback({ data, memory, refresh: refreshEvents, clock }: LivePlaybackDependencies) {
  const [view, setView] = useState<LiveView>(EMPTY);
  const [epgState, setEpgState] = useState<{ groups: LiveGroup[] | null; index: number; profileId: string; byKey: Record<string, LiveEpgEntry> }>({ groups: null, index: 0, profileId: '', byKey: {} });
  const [catchupUrl, setCatchupUrl] = useState<string | null>(null);
  const [catchupTitle, setCatchupTitle] = useState<string>('');
  const [liveToast, setLiveToast] = useState<string>('');
  const epg = epgState.groups === view.groups && epgState.index === view.liveIdx && epgState.profileId === view.profileId ? epgState.byKey : {};
  const sequence = useRef(0);
  const loadedSpec = useRef('');
  const configSequence = useRef(0);
  const configRef = useRef<UserConfig | null>(null);

  const load = useCallback(async (config: UserConfig, index: number, request: number) => {
    const next: LiveView = { ...EMPTY, profileId: config.activeProfileId, lives: config.lives, liveIdx: index, liveName: config.lives[index]?.name || '', loading: config.lives.length > 0 };
    setView(next);
    if (!config.lives.length) { loadedSpec.current = specKey(config, index); return; }
    try {
      const result = await data.loadLineup(index);
      if (request !== sequence.current) return;
      const populated = { ...next, groups: result.groups, liveName: result.liveName, loading: false };
      const mem = memory.read(liveSelectionMemoryKey(config.activeProfileId, config.lives[index], index));
      const group = result.groups.find(item => item.group === mem.groupName) ?? result.groups.find(item => item.channels.length) ?? result.groups[0];
      const channel = group?.channels.find(item => item.name === mem.channelName) ?? group?.channels[0];
      const selection = selectLiveChannel(result.groups, group?.group ?? '', channel?.name ?? '', mem.lineIdx ?? 0);
      const selected = { ...populated, ...selection };
      loadedSpec.current = specKey(config, index);
      setView(selected);
    } catch (error) {
      if (request === sequence.current) setView({ ...next, loading: false, err: error instanceof Error ? error.message : String(error) });
    }
  }, [data, memory]);

  const reload = useCallback(async () => {
    const configRequest = ++configSequence.current;
    try {
      const config = await data.readConfiguration();
      if (configRequest !== configSequence.current) return;
      configRef.current = config;
      const wanted = config.ui.activeLiveIndex;
      const index = Number.isInteger(wanted) && wanted >= 0 && wanted < config.lives.length ? wanted : 0;
      if (loadedSpec.current === specKey(config, index)) return;
      loadedSpec.current = '';
      await load(config, index, ++sequence.current);
    } catch (error) {
      if (configRequest === configSequence.current) setView({ ...EMPTY, err: error instanceof Error ? error.message : String(error) });
    }
  }, [data, load]);

  useEffect(() => {
    const refresh = () => { void reload(); };
    refresh();
    const unsubscribeSources = refreshEvents.onSourcesChanged(refresh);
    const unsubscribeFocus = refreshEvents.onWindowFocus(refresh);
    return () => {
      sequence.current += 1;
      configSequence.current += 1;
      unsubscribeSources();
      unsubscribeFocus();
    };
  }, [refreshEvents, reload]);

  useEffect(() => {
    if (view.loading || !view.groups.length) return;
    memory.write(
      liveSelectionMemoryKey(view.profileId, view.lives[view.liveIdx], view.liveIdx),
      { groupName: view.groupName, channelName: view.channelName, lineIdx: view.lineIdx },
    );
  }, [memory, view.channelName, view.groupName, view.groups, view.lineIdx, view.liveIdx, view.lives, view.loading, view.profileId]);

  const pickLive = useCallback((index: number) => {
    const config = configRef.current;
    if (!config || !Number.isInteger(index) || index < 0 || index >= config.lives.length) return;
    configSequence.current += 1;
    const request = ++sequence.current;
    loadedSpec.current = '';
    setCatchupUrl(null);
    setCatchupTitle('');
    configRef.current = { ...config, ui: { ...config.ui, activeLiveIndex: index } };
    void data.setActiveLineup(index).catch(() => undefined);
    void load(config, index, request);
  }, [data, load]);

  const pickChannel = useCallback((group: LiveGroup, name: string, index: number) => {
    setCatchupUrl(null);
    setCatchupTitle('');
    setView(current => {
      return { ...current, ...selectLiveChannel(current.groups, group.group, name, index) };
    });
  }, []);

  const curGroup = view.groups.find(group => group.group === view.groupName);
  const curChannel = curGroup?.channels.find(channel => channel.name === view.channelName);
  const curEpg = curChannel ? epg[curChannel['tvg-id']] || epg[curChannel['tvg-name']] || epg[curChannel.name] : undefined;
  const lines = curChannel?.urls.map((url, i) => splitLine(url, i + 1)) ?? [];

  const playCatchup = useCallback((prog: EpgProgram) => {
    if (!curChannel || !view.playUrl) return;
    const url = buildCatchupUrl(view.playUrl, curChannel.catchup, prog.startTime, prog.endTime);
    if (url) {
      setCatchupUrl(url);
      setCatchupTitle(`${prog.title} (${prog.start}-${prog.end})`);
      setLiveToast(`正在时移回看：${prog.title}（${prog.start}-${prog.end}）`);
    } else {
      setLiveToast('该频道暂未配置时移回看规则');
    }
  }, [curChannel, view.playUrl]);

  const exitCatchup = useCallback(() => {
    setCatchupUrl(null);
    setCatchupTitle('');
    setLiveToast('已恢复实时直播');
  }, []);

  const failoverToNextLine = useCallback((reason: string) => {
    if (lines.length > 1) {
      const nextIndex = (view.lineIdx + 1) % lines.length;
      setCatchupUrl(null);
      setCatchupTitle('');
      setLiveToast(`当前线路卡顿异常（${reason}），已自动为您切至线路 ${nextIndex + 1}`);
      pickChannel(curGroup!, view.channelName, nextIndex);
      return true;
    }
    return false;
  }, [lines.length, view.lineIdx, curGroup, view.channelName, pickChannel]);

  useEffect(() => {
    if (!liveToast) return;
    const timer = setTimeout(() => setLiveToast(''), 3500);
    return () => clearTimeout(timer);
  }, [liveToast]);

  useEffect(() => {
    let alive = true;
    let timer: unknown;
    const request = sequence.current;
    const refs = view.groups.flatMap(group => group.channels).map(channel => ({ tvgId: channel['tvg-id'], tvgName: channel['tvg-name'], name: channel.name, epg: channel.epg }));
    const refresh = async () => {
      if (!refs.length) return;
      try {
        const result = await data.loadProgramGuide(view.liveIdx, refs);
        if (!alive || request !== sequence.current) return;
        setEpgState({ groups: view.groups, index: view.liveIdx, profileId: view.profileId, byKey: result.byKey });
        const entry = curChannel ? result.byKey[curChannel['tvg-id']] || result.byKey[curChannel['tvg-name']] || result.byKey[curChannel.name] : undefined;
        const at = entry?.current?.endTime ?? entry?.next?.startTime;
        if (at) timer = clock.schedule(() => { void refresh(); }, Math.max(1000, Math.min(at - clock.now() + 1000, 6 * 3600 * 1000)));
      } catch { if (alive && request === sequence.current) setEpgState({ groups: view.groups, index: view.liveIdx, profileId: view.profileId, byKey: {} }); }
    };
    void refresh();
    return () => { alive = false; if (timer !== undefined) clock.cancel(timer); };
  }, [clock, data, view.groups, view.liveIdx, view.profileId, curChannel]);

  const activePlayUrl = catchupUrl || view.playUrl;

  return {
    ...view,
    playUrl: activePlayUrl,
    curGroup,
    curChannel,
    curEpg,
    lines,
    liveToast,
    isCatchupActive: Boolean(catchupUrl),
    catchupTitle,
    playCatchup,
    exitCatchup,
    failoverToNextLine,
    pickLive,
    pickChannel,
  };
}

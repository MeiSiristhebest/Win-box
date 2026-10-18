import { useCallback, useEffect, useRef, useState } from 'react';
import { client } from '../../api/client';
import type { LiveBean, LiveEpgEntry, LiveGroup, UserConfig } from '../../../shared/types';
import { splitLine } from '../../../engine/live/LiveUtils';
import { SOURCES_CHANGED_EVENT } from '../../lib/configEvents';

interface LiveView {
  profileId: string; lives: LiveBean[]; liveIdx: number; groups: LiveGroup[];
  groupName: string; channelName: string; lineIdx: number; playUrl: string; liveName: string;
  loading: boolean; err: string;
}
interface LiveMemory { groupName?: string; channelName?: string; lineIdx?: number }
const EMPTY: LiveView = { profileId: '', lives: [], liveIdx: 0, groups: [], groupName: '', channelName: '', lineIdx: 0, playUrl: '', liveName: '', loading: false, err: '' };

function memoryKey(view: Pick<LiveView, 'profileId' | 'liveIdx' | 'lives'>): string {
  const live = view.lives[view.liveIdx];
  return 'winbox-live-mem:' + JSON.stringify([view.profileId, live?.url || live?.api || '', view.liveIdx]);
}
function readMemory(view: LiveView): LiveMemory {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(memoryKey(view)) || '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const value = raw as Record<string, unknown>;
    return { groupName: typeof value.groupName === 'string' ? value.groupName : undefined, channelName: typeof value.channelName === 'string' ? value.channelName : undefined, lineIdx: Number.isSafeInteger(value.lineIdx) && Number(value.lineIdx) >= 0 ? Number(value.lineIdx) : 0 };
  } catch { return {}; }
}
function remember(view: LiveView): void {
  try { localStorage.setItem(memoryKey(view), JSON.stringify({ groupName: view.groupName, channelName: view.channelName, lineIdx: view.lineIdx })); } catch { /* Storage may be disabled. */ }
}
function selectChannel(view: LiveView, groupName: string, channelName: string, index: number): LiveView {
  const group = view.groups.find(item => item.group === groupName);
  const channel = group?.channels.find(item => item.name === channelName);
  const lineIdx = channel && index >= 0 && index < channel.urls.length ? index : 0;
  return { ...view, groupName, channelName, lineIdx, playUrl: channel?.urls.length ? splitLine(channel.urls[lineIdx], lineIdx + 1).url : '' };
}
function specKey(config: UserConfig, index: number): string {
  return JSON.stringify([config.activeProfileId, config.lives, index]);
}

/** Live metadata, playback selection and request lifetime belong to the same profile snapshot. */
export function useLivePlayback() {
  const [view, setView] = useState<LiveView>(EMPTY);
  const [epgState, setEpgState] = useState<{ groups: LiveGroup[] | null; index: number; profileId: string; byKey: Record<string, LiveEpgEntry> }>({ groups: null, index: 0, profileId: '', byKey: {} });
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
      const result = await client.loadLive(index);
      if (request !== sequence.current) return;
      const populated = { ...next, groups: result.groups, liveName: result.liveName, loading: false };
      const mem = readMemory(populated);
      const group = result.groups.find(item => item.group === mem.groupName) ?? result.groups.find(item => item.channels.length) ?? result.groups[0];
      const channel = group?.channels.find(item => item.name === mem.channelName) ?? group?.channels[0];
      const selected = selectChannel(populated, group?.group ?? '', channel?.name ?? '', mem.lineIdx ?? 0);
      loadedSpec.current = specKey(config, index);
      setView(selected);
      remember(selected);
    } catch (error) {
      if (request === sequence.current) setView({ ...next, loading: false, err: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  const reload = useCallback(async () => {
    const configRequest = ++configSequence.current;
    try {
      const config = await client.cfgGet();
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
  }, [load]);

  useEffect(() => {
    const refresh = () => { void reload(); };
    refresh();
    window.addEventListener(SOURCES_CHANGED_EVENT, refresh);
    window.addEventListener('focus', refresh);
    return () => {
      sequence.current += 1;
      configSequence.current += 1;
      window.removeEventListener(SOURCES_CHANGED_EVENT, refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [reload]);

  const pickLive = useCallback((index: number) => {
    const config = configRef.current;
    if (!config || !Number.isInteger(index) || index < 0 || index >= config.lives.length) return;
    configSequence.current += 1;
    const request = ++sequence.current;
    loadedSpec.current = '';
    configRef.current = { ...config, ui: { ...config.ui, activeLiveIndex: index } };
    void client.cfgSetActiveLive(index).catch(() => undefined);
    void load(config, index, request);
  }, [load]);

  const pickChannel = useCallback((group: LiveGroup, name: string, index: number) => {
    setView(current => {
      const selected = selectChannel(current, group.group, name, index);
      remember(selected);
      return selected;
    });
  }, []);

  const curGroup = view.groups.find(group => group.group === view.groupName);
  const curChannel = curGroup?.channels.find(channel => channel.name === view.channelName);
  const curEpg = curChannel ? epg[curChannel['tvg-id']] || epg[curChannel['tvg-name']] || epg[curChannel.name] : undefined;
  const lines = curChannel?.urls.map((url, i) => splitLine(url, i + 1)) ?? [];

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const request = sequence.current;
    const refs = view.groups.flatMap(group => group.channels).map(channel => ({ tvgId: channel['tvg-id'], tvgName: channel['tvg-name'], name: channel.name, epg: channel.epg }));
    const refresh = async () => {
      if (!refs.length) return;
      try {
        const result = await client.liveEpg(view.liveIdx, refs);
        if (!alive || request !== sequence.current) return;
        setEpgState({ groups: view.groups, index: view.liveIdx, profileId: view.profileId, byKey: result.byKey });
        const entry = curChannel ? result.byKey[curChannel['tvg-id']] || result.byKey[curChannel['tvg-name']] || result.byKey[curChannel.name] : undefined;
        const at = entry?.current?.endTime ?? entry?.next?.startTime;
        if (at) timer = setTimeout(() => { void refresh(); }, Math.max(1000, Math.min(at - Date.now() + 1000, 6 * 3600 * 1000)));
      } catch { if (alive && request === sequence.current) setEpgState({ groups: view.groups, index: view.liveIdx, profileId: view.profileId, byKey: {} }); }
    };
    void refresh();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [view.groups, view.liveIdx, view.profileId, curChannel]);

  return { ...view, curGroup, curChannel, curEpg, lines, pickLive, pickChannel };
}

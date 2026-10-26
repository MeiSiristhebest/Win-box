import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { MpvAudioTrack } from '../../../shared/player';
import { isEngineKernel, type Kernel } from '../../lib/kernel';
import type { SessionAudioPreferencePort } from './application/sessionAudioPreference';
import type { PlayerAudioTracksPort } from './application/playerAudioTracks';

export function audioTrackKey(track: MpvAudioTrack): string { return (track.lang || track.title || 'id:' + track.id).trim(); }
export function audioTrackLabel(track: MpvAudioTrack, index: number): string {
  const parts = [track.lang, track.title, track.codec, track.channels ? track.channels + '声道' : ''].filter(Boolean);
  return parts.length ? parts.join(' · ') : '音轨 ' + (index + 1);
}

export function usePlayerAudioTracks(
  url: string,
  kernel: Kernel,
  port: PlayerAudioTracksPort,
  preference: SessionAudioPreferencePort,
) {
  const key = kernel + '\u0000' + url;
  const [state, setState] = useState<{ key: string; tracks: MpvAudioTrack[]; aid: number | null; open: boolean }>(() => ({ key, tracks: [], aid: null, open: false }));
  if (state.key !== key) setState({ key, tracks: [], aid: null, open: false });
  const tracks = state.key === key ? state.tracks : [];
  const aid = state.key === key ? state.aid : null;
  const open = state.key === key && state.open;
  const setOpen = useCallback((value: boolean) => setState(previous => previous.key === key ? { ...previous, open: value } : { key, tracks: [], aid: null, open: value }), [key]);
  const context = useRef({ url, kernel });
  const applied = useRef('');
  const retries = useRef({ key: '', id: -1, count: 0 });
  useLayoutEffect(() => {
    context.current = { url, kernel };
    applied.current = '';
    retries.current = { key: '', id: -1, count: 0 };
  }, [url, kernel]);
  const apply = useCallback((track: MpvAudioTrack) => {
    if (isEngineKernel(context.current.kernel)) port.selectEngineTrack(track.id);
    else if (context.current.kernel === 'mpv') port.selectMpvTrack(track.id);
    else port.selectAdaptiveTrack(track.id);
    preference.rememberPreferredTrackKey(audioTrackKey(track));
  }, [port, preference]);
  const sync = useCallback((list: MpvAudioTrack[], selected: number | null) => {
    const pref = preference.readPreferredTrackKey();
    const key = context.current.kernel + '\u0000' + context.current.url;
    setState(previous => previous.key === key && JSON.stringify(previous.tracks) === JSON.stringify(list) && previous.aid === selected ? previous : { key, tracks: list, aid: selected, open: previous.key === key && previous.open });
    if (!pref || applied.current === key) return;
    const hit = list.find(track => audioTrackKey(track) === pref);
    if (!hit) return;
    if (selected === hit.id) { applied.current = key; return; }
    const prior = retries.current;
    const count = prior.key === key && prior.id === hit.id ? prior.count : 0;
    if (count >= 3) { applied.current = key; return; }
    retries.current = { key, id: hit.id, count: count + 1 };
    apply(hit);
  }, [apply, preference]);
  const syncAdaptive = useCallback(() => {
    const snapshot = port.readAdaptiveTracks();
    if (snapshot) sync(snapshot.tracks, snapshot.selectedTrackId);
  }, [port, sync]);
  return { tracks, aid, open, setOpen, apply, sync, syncAdaptive };
}

import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type Hls from 'hls.js';
import type { MpvAudioTrack } from '../../../shared/player';
import type { Kernel } from '../../lib/kernel';
import { getSessionAudioPref, setSessionAudioPref } from '../../lib/playerPrefs';
import { client } from '../../api/client';

export function audioTrackKey(track: MpvAudioTrack): string { return (track.lang || track.title || 'id:' + track.id).trim(); }
export function audioTrackLabel(track: MpvAudioTrack, index: number): string {
  const parts = [track.lang, track.title, track.codec, track.channels ? track.channels + '声道' : ''].filter(Boolean);
  return parts.length ? parts.join(' · ') : '音轨 ' + (index + 1);
}

export function usePlayerAudioTracks(url: string, kernel: Kernel, hlsRef: RefObject<Hls | null>) {
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
    if (context.current.kernel === 'mpv') void client.mpvCmd({ type: 'aid', value: track.id }).catch(() => undefined);
    else if (hlsRef.current) hlsRef.current.audioTrack = track.id;
    setSessionAudioPref(audioTrackKey(track));
  }, [hlsRef]);
  const sync = useCallback((list: MpvAudioTrack[], selected: number | null) => {
    const pref = getSessionAudioPref();
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
  }, [apply]);
  const syncHls = useCallback(() => {
    const hls = hlsRef.current;
    if (!hls) return;
    const list: MpvAudioTrack[] = hls.audioTracks.map((raw, index) => ({
      id: index, title: raw.name || undefined, lang: raw.lang || undefined,
      channels: raw.attrs?.CHANNELS || undefined, selected: hls.audioTrack === index || undefined,
    }));
    sync(list, hls.audioTrack >= 0 ? hls.audioTrack : null);
  }, [hlsRef, sync]);
  return { tracks, aid, open, setOpen, apply, sync, syncHls };
}

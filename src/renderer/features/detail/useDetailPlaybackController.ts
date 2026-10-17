import { useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { Episode, VodDetail } from '../../../shared/types';
import { client } from '../../api/client';
import { formatEpisodeLabel } from '../../lib/epName';
import { uiMem, schedulePersist } from '../../lib/uiMemory';
import { playbackResultError } from '../../../shared/playbackResult';
import { makeStaleGuard } from '../../lib/staleGuard';

type PlayGeneration = ReturnType<typeof makeStaleGuard>;

type DetailPlaybackControllerOptions = {
  key: string | undefined;
  id: string | undefined;
  profileId: string;
  memKey: string;
  detail: VodDetail | null;
  displayName: string;
  flag: string;
  setFlag: Dispatch<SetStateAction<string>>;
  ep: number;
  setEp: Dispatch<SetStateAction<number>>;
  setEpPage: Dispatch<SetStateAction<number>>;
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setErr: Dispatch<SetStateAction<string>>;
  contentRef: MutableRefObject<HTMLDivElement | null>;
  playGenRef: MutableRefObject<PlayGeneration>;
  onPlay: (url: string, name: string, fromKey: string, id: string, meta?: {
    pic?: string;
    remarks?: string;
    sourceName?: string;
    title?: string;
    vodId?: string;
    episodes?: Episode[];
    epIndex?: number;
    flag?: string;
    profileId?: string;
  }) => void;
  onNeedDriveCookieBind: (provider: string) => void;
};

export function useDetailPlaybackController({
  key,
  id,
  profileId,
  memKey,
  detail,
  displayName,
  flag,
  setFlag,
  ep,
  setEp,
  setEpPage,
  busy,
  setBusy,
  setErr,
  contentRef,
  playGenRef,
  onPlay,
  onNeedDriveCookieBind,
}: DetailPlaybackControllerOptions) {
  const playIntentRef = useRef('');

  function chooseFlag(nextFlag: string) {
    playGenRef.current.next();
    setBusy(false);
    setFlag(nextFlag);
    setEp(0);
    setEpPage(0);
    uiMem.detail.set(memKey, { flag: nextFlag, ep: 0, scrollTop: contentRef.current?.scrollTop ?? 0 });
  }

  function chooseEp(index: number) {
    playGenRef.current.next();
    setBusy(false);
    setEp(index);
    uiMem.detail.set(memKey, { flag, ep: index, scrollTop: contentRef.current?.scrollTop ?? 0 });
    schedulePersist();
  }

  async function play(index = ep) {
    if (!detail || !flag) return;
    const episodes = detail.episodes[flag] || [];
    const target = episodes[index];
    if (!target) return;
    const intent = `${key}|${flag}|${index}`;
    if (busy && playIntentRef.current === intent) return;
    playIntentRef.current = intent;
    const gen = playGenRef.current.next();
    setErr('');
    setBusy(true);
    try {
      if (!profileId) throw new Error('详情页尚未确定所属订阅');
      if (!playGenRef.current.isCurrent(gen)) return;
      const result = await client.play({ key: key!, flag, id: target.url, profileId });
      if (!playGenRef.current.isCurrent(gen)) return;
      if (result.needDriveCookieBind) {
        setErr('');
        onNeedDriveCookieBind(String(result.needDriveCookieBind));
        return;
      }
      const playError = playbackResultError(result);
      if (playError) {
        setErr(playError);
        return;
      }
      const label = formatEpisodeLabel(target.name, index);
      onPlay(result.url, `${displayName} - ${label}`, key!, id!, {
        pic: detail.pic,
        remarks: label,
        sourceName: key,
        profileId,
        title: displayName || undefined,
        vodId: detail.id,
        episodes,
        epIndex: index,
        flag,
      });
    } catch (error) {
      if (!playGenRef.current.isCurrent(gen)) return;
      setErr((error as Error).message);
    } finally {
      if (playGenRef.current.isCurrent(gen)) setBusy(false);
    }
  }

  return { chooseFlag, chooseEp, play };
}

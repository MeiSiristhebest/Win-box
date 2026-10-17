import { useCallback, useEffect, useRef, useState } from 'react';
import { client } from '../../api/client';
import { EP_PAGE_SIZE } from '../../lib/epPager';
import { uiMem } from '../../lib/uiMemory';
import { makeStaleGuard } from '../../lib/staleGuard';
import type { VodDetail } from '../../../shared/types';

const autoAggregateDone = new Set<string>();

type DetailDataControllerArgs = {
  key: string | undefined;
  id: string | undefined;
  requestedProfileId: string;
  routeKey: string;
};

export function useDetailDataController({ key, id, requestedProfileId, routeKey }: DetailDataControllerArgs) {
  const [resolvedProfile, setResolvedProfile] = useState<{ routeKey: string; profileId: string }>({ routeKey: '', profileId: '' });
  const profileId = requestedProfileId || (resolvedProfile.routeKey === routeKey ? resolvedProfile.profileId : '');
  const memKey = `${profileId || 'active'}:${key || ''}:${id || ''}`;
  const [detail, setDetail] = useState<VodDetail | null>(null);
  const [flag, setFlag] = useState('');
  const [ep, setEp] = useState(0);
  const [epPage, setEpPage] = useState(0);
  const [stateRouteKey, setStateRouteKey] = useState(routeKey);
  const [loading, setLoading] = useState(Boolean(key && id));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const playGenRef = useRef(makeStaleGuard());
  const autoAggRef = useRef(autoAggregateDone.has(memKey));

  useEffect(() => {
    if (!key || !id) return;
    const currentKey = key;
    const currentId = id;
    let alive = true;
    const playGeneration = playGenRef.current;
    playGeneration.next();
    void (async () => {
      try {
        const selectedProfileId = requestedProfileId || (await client.cfgGet()).activeProfileId;
        if (!alive) return;
        const scopedMemKey = `${selectedProfileId}:${currentKey}:${currentId}`;
        autoAggRef.current = autoAggregateDone.has(scopedMemKey);
        const nextDetail = await client.detail({ key: currentKey, ids: [currentId], profileId: selectedProfileId });
        if (!alive) return;
        setResolvedProfile({ routeKey, profileId: selectedProfileId });
        setStateRouteKey(routeKey);
        setDetail(nextDetail);
        setErr('');
        setBusy(false);
        if (nextDetail && nextDetail.flags.length) {
          const remembered = uiMem.detail.get(scopedMemKey);
          const selectedFlag = remembered && nextDetail.flags.includes(remembered.flag) ? remembered.flag : nextDetail.flags[0];
          const episodes = nextDetail.episodes[selectedFlag] || [];
          const selectedEpisode = remembered && remembered.ep >= 0 && remembered.ep < episodes.length ? remembered.ep : 0;
          setFlag(selectedFlag);
          setEp(selectedEpisode);
          setEpPage(Math.floor(selectedEpisode / EP_PAGE_SIZE));
          uiMem.detail.set(scopedMemKey, { flag: selectedFlag, ep: selectedEpisode, scrollTop: remembered?.scrollTop ?? 0 });
        } else {
          setFlag('');
          setEp(0);
          setEpPage(0);
        }
      } catch (error) {
        if (alive) {
          setStateRouteKey(routeKey);
          setDetail(null);
          setFlag('');
          setEp(0);
          setEpPage(0);
          setBusy(false);
          setErr((error as Error).message);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
      playGeneration.next();
    };
  }, [key, id, requestedProfileId, routeKey]);

  const markAutoAggregateDone = useCallback((): void => {
    autoAggregateDone.add(memKey);
    autoAggRef.current = true;
  }, [memKey]);

  const routeIsCurrent = stateRouteKey === routeKey;
  return {
    profileId,
    memKey,
    detail: routeIsCurrent ? detail : null,
    flag: routeIsCurrent ? flag : '',
    setFlag,
    ep: routeIsCurrent ? ep : 0,
    setEp,
    epPage: routeIsCurrent ? epPage : 0,
    setEpPage,
    loading: routeIsCurrent ? loading : Boolean(key && id),
    err: routeIsCurrent ? err : '',
    setErr,
    busy: routeIsCurrent ? busy : false,
    setBusy,
    playGenRef,
    autoAggRef,
    markAutoAggregateDone,
  };
}

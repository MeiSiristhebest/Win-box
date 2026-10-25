import { useEffect, useRef, useState } from 'react';
import { makeStaleGuard } from '../../lib/staleGuard';
import type { VodDetail } from '../../../shared/types';
import type { DetailDataPort } from './application/detailDataPorts';
import { loadDetailRoute } from './application/detailDataUseCase';

type DetailDataControllerArgs = {
  key: string | undefined;
  id: string | undefined;
  requestedProfileId: string;
  routeKey: string;
};

export function useDetailDataController({ key, id, requestedProfileId, routeKey }: DetailDataControllerArgs, port: DetailDataPort) {
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

  useEffect(() => {
    if (!key || !id) return;
    const currentKey = key;
    const currentId = id;
    let alive = true;
    const playGeneration = playGenRef.current;
    playGeneration.next();
    void (async () => {
      try {
        const loaded = await loadDetailRoute({ key: currentKey, id: currentId, requestedProfileId }, port);
        if (!alive) return;
        setResolvedProfile({ routeKey, profileId: loaded.profileId });
        setStateRouteKey(routeKey);
        setDetail(loaded.detail);
        setErr('');
        setBusy(false);
        setFlag(loaded.flag);
        setEp(loaded.episodeIndex);
        setEpPage(loaded.episodePage);
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
  }, [key, id, requestedProfileId, routeKey, port]);

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
  };
}

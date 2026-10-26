import { useCallback, useEffect, useState } from 'react';
import {
  observeDetailFavorite,
  toggleDetailFavorite,
  hasDetailFavoriteIdentity,
  type DetailFavoriteInput,
  type DetailFavoritePort,
} from './application/detailFavorite';

export function useDetailFavorite(input: DetailFavoriteInput, port: DetailFavoritePort) {
  const {
    sourceKey, vodId, name, profileId, fallbackName, sourceName, pic, remarks, year, type,
  } = input;
  const identity = JSON.stringify([profileId, sourceKey, vodId, name]);
  const [state, setState] = useState<{ identity: string; favorited: boolean }>({ identity: '', favorited: false });
  const setCurrentFavorite = useCallback((favorited: boolean) => {
    setState({ identity, favorited });
  }, [identity]);

  useEffect(() => observeDetailFavorite(
    { sourceKey, vodId, name, profileId },
    port,
    setCurrentFavorite,
  ), [name, port, profileId, sourceKey, vodId]);

  const toggle = useCallback(() => {
    const result = toggleDetailFavorite({
      sourceKey, vodId, name, profileId, fallbackName, sourceName, pic, remarks, year, type,
    }, port);
    setCurrentFavorite(result.favorited);
    return result;
  }, [fallbackName, name, pic, port, profileId, remarks, setCurrentFavorite, sourceKey, sourceName, type, vodId, year]);

  return {
    favorited: state.identity === identity && state.favorited,
    canToggle: hasDetailFavoriteIdentity({ profileId, sourceKey, vodId, name }),
    toggle,
  };
}

import { useEffect, useState } from 'react';
import type { DetailFavoriteMetadata, DetailFavoriteMetadataPort } from './application/detailFavoriteMetadata';

const emptyMetadata: DetailFavoriteMetadata = { profileId: '', sourceName: '' };
interface MetadataState {
  requestKey: string;
  metadata: DetailFavoriteMetadata;
}

/** Resolves the source/profile labels used by the detail page's favorite action. */
export function useDetailFavoriteMetadata(
  sourceKey: string,
  requestedProfileId: string,
  port: DetailFavoriteMetadataPort,
): DetailFavoriteMetadata {
  const requestKey = JSON.stringify([sourceKey, requestedProfileId]);
  const [state, setState] = useState<MetadataState>({ requestKey: '', metadata: emptyMetadata });

  useEffect(() => {
    let active = true;
    setState({ requestKey, metadata: emptyMetadata });
    void port.load(sourceKey, requestedProfileId)
      .then((result) => {
        if (active) setState({ requestKey, metadata: result });
      })
      .catch(() => {
        if (active) {
          // A route-supplied profile remains authoritative if label lookup fails.
          setState({ requestKey, metadata: { ...emptyMetadata, profileId: requestedProfileId } });
        }
      });
    return () => { active = false; };
  }, [port, requestKey, requestedProfileId, sourceKey]);

  return state.requestKey === requestKey
    ? state.metadata
    : emptyMetadata;
}

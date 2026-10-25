import { useEffect, useState } from 'react';
import type { DetailFavoriteMetadata, DetailFavoriteMetadataPort } from './application/detailFavoriteMetadata';

const emptyMetadata: DetailFavoriteMetadata = { profileId: '', sourceName: '' };

/** Resolves the source/profile labels used by the detail page's favorite action. */
export function useDetailFavoriteMetadata(
  sourceKey: string,
  requestedProfileId: string,
  port: DetailFavoriteMetadataPort,
): DetailFavoriteMetadata {
  const [metadata, setMetadata] = useState(emptyMetadata);

  useEffect(() => {
    let active = true;
    void port.load(sourceKey, requestedProfileId)
      .then((result) => {
        if (active) setMetadata(result);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [port, requestedProfileId, sourceKey]);

  return metadata;
}

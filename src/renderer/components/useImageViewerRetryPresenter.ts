import { useCallback, useState } from 'react';
import { imageViewerRetryUrl } from './imageViewerPolicy';

/** Projects the current image URL and owns the explicit retry request state. */
export function useImageViewerRetryPresenter(url: string) {
  const [retry, setRetry] = useState(0);
  const onRetry = useCallback(() => setRetry((current) => current + 1), []);
  return { src: imageViewerRetryUrl(url, retry), onRetry };
}

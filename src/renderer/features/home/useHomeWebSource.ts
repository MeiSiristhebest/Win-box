import { useCallback, useEffect, useRef, useState } from 'react';
import type { SourceBean } from '../../../shared/types';
import type { HomeWebSourcePort } from './application/homePorts';

/** Owns opening a source-provided web home and its request-local feedback state. */
export function useHomeWebSource({ source, port }: { source?: SourceBean; port: HomeWebSourcePort }) {
  const homePageUrl = (source?.homePage || '').trim();
  const requestKey = source ? `${source.key}\u0000${homePageUrl}` : '';
  const [feedback, setFeedback] = useState<{ requestKey: string; opening: boolean; error: string }>({ requestKey: '', opening: false, error: '' });
  const opening = feedback.requestKey === requestKey && feedback.opening;
  const error = feedback.requestKey === requestKey ? feedback.error : '';
  const requestGeneration = useRef(0);
  const inFlight = useRef(false);

  useEffect(() => {
    requestGeneration.current += 1;
    inFlight.current = false;
    return () => {
      requestGeneration.current += 1;
      inFlight.current = false;
    };
  }, [requestKey]);

  const open = useCallback(async (): Promise<void> => {
    if (!source || !homePageUrl || inFlight.current) return;

    inFlight.current = true;
    const generation = ++requestGeneration.current;
    setFeedback({ requestKey, opening: true, error: '' });
    try {
      const result = await port.open({
        url: homePageUrl,
        title: `${source.name || '网页源'} · 网页`,
        site: {
          key: source.key,
          name: source.name,
          api: source.api,
          ext: source.ext,
          homePage: homePageUrl,
        },
      });
      if (requestGeneration.current === generation && !result.ok) {
        setFeedback({ requestKey, opening: true, error: result.error || '打开网页源失败' });
      }
    } catch (cause) {
      if (requestGeneration.current === generation) {
        setFeedback({ requestKey, opening: true, error: cause instanceof Error ? cause.message : String(cause) });
      }
    } finally {
      if (requestGeneration.current === generation) {
        inFlight.current = false;
        setFeedback((previous) => previous.requestKey === requestKey ? { ...previous, opening: false } : previous);
      }
    }
  }, [homePageUrl, port, requestKey, source]);

  return { homePageUrl, opening, error, open };
}

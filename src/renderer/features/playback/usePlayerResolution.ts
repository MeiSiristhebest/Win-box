import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Kernel } from '../../lib/kernel';
import { formatVideoResolution } from '../../lib/videoResolution';
import type { PlaybackResourceIdentity } from './application/playbackHandoff';

interface PlayerResolutionOptions extends PlaybackResourceIdentity {
  kernel: Kernel;
  videoRef: { current: HTMLVideoElement | null };
  htmlUrl: string;
  htmlEnabled: boolean;
  sourceWidth?: number;
  sourceHeight?: number;
  onResolutionChange?: (resolution: string) => void;
}

/** Presents the current resource's dimensions and adapts HTML metadata/resize events. */
export function usePlayerResolution(options: PlayerResolutionOptions) {
  const { url, progressKey, kernel, videoRef, htmlUrl, htmlEnabled, sourceWidth, sourceHeight, onResolutionChange } = options;
  const resourceKey = JSON.stringify([url, progressKey, kernel]);
  const [state, setState] = useState({ resourceKey, resolution: '' });
  const last = useRef({ resourceKey: '', resolution: '' });
  const current = useRef({ resourceKey, onResolutionChange, active: true });
  useLayoutEffect(() => {
    current.current = { resourceKey, onResolutionChange, active: true };
    return () => { current.current.active = false; };
  }, [resourceKey, onResolutionChange]);
  const reportResolution = useCallback((width: unknown, height: unknown) => {
    if (!current.current.active || current.current.resourceKey !== resourceKey) return;
    const resolution = formatVideoResolution(width, height);
    if (last.current.resourceKey === resourceKey && last.current.resolution === resolution) return;
    last.current = { resourceKey, resolution };
    setState({ resourceKey, resolution });
    current.current.onResolutionChange?.(resolution);
  }, [resourceKey]);
  useEffect(() => { reportResolution(0, 0); }, [reportResolution]);

  useEffect(() => {
    if (!htmlEnabled || !htmlUrl || kernel !== 'html5') return;
    const video = videoRef.current;
    if (!video) return;
    const originalResolution = formatVideoResolution(sourceWidth, sourceHeight);
    const update = () => {
      // A compatibility stream may be downsampled; retain the original media dimensions when known.
      if (originalResolution) reportResolution(sourceWidth, sourceHeight);
      else reportResolution(video.videoWidth, video.videoHeight);
    };
    video.addEventListener('loadedmetadata', update);
    video.addEventListener('resize', update);
    video.addEventListener('canplay', update);
    if (originalResolution) update();
    return () => {
      video.removeEventListener('loadedmetadata', update);
      video.removeEventListener('resize', update);
      video.removeEventListener('canplay', update);
    };
  }, [kernel, htmlEnabled, htmlUrl, sourceWidth, sourceHeight, videoRef, reportResolution]);

  return { resolution: state.resourceKey === resourceKey ? state.resolution : '', reportResolution };
}

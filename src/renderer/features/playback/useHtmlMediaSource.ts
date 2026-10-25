import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KernelPref } from '../../lib/kernel';
import type { PlaybackHandoff, PlaybackResourceIdentity } from './application/playbackHandoff';
import { createHtmlMediaPreparation, type HtmlMediaSourcePort, type PreparedHtmlMediaSource } from './application/htmlMediaSource';
import type { PlayerPlaybackPresentationUpdate } from './application/PlayerPlaybackPresentation';

export interface HtmlMediaSourceOptions extends PlaybackResourceIdentity {
  enabled: boolean;
  port: HtmlMediaSourcePort;
  nativePlayback: { allowed: boolean; available: boolean; preference: KernelPref };
  onCompatibilityDetected(resource: PlaybackResourceIdentity): void;
  onNativeHandoff(handoff: PlaybackHandoff): void;
  updatePlaybackStatus(update: PlayerPlaybackPresentationUpdate): void;
  recoverHtmlPlayback(): boolean;
}

/** Presents one prepared HTML source and owns cancellation/cleanup when its playback scope changes. */
export function useHtmlMediaSource(options: HtmlMediaSourceOptions): PreparedHtmlMediaSource | null {
  const { url, progressKey, enabled, port } = options;
  const requestKey = JSON.stringify([url, progressKey, enabled]);
  const [state, setState] = useState<{ requestKey: string; port: HtmlMediaSourcePort; source: PreparedHtmlMediaSource | null }>(() => ({ requestKey, port, source: null }));
  // Clear a deactivated lease before any child media effect can observe its released URL again.
  if (state.requestKey !== requestKey || state.port !== port) setState({ requestKey, port, source: null });
  const latest = useRef(options);
  useLayoutEffect(() => { latest.current = options; });

  useEffect(() => {
    if (!enabled || !url) return;
    let active = true;
    const failed = (error: unknown) => {
      if (!active) return;
       latest.current.updatePlaybackStatus({ loading: false });
      if (!latest.current.recoverHtmlPlayback()) {
         latest.current.updatePlaybackStatus({ error: `播放准备失败：${error instanceof Error ? error.message : String(error)}` });
      }
    };
    let preparation: ReturnType<typeof createHtmlMediaPreparation>;
    try { preparation = createHtmlMediaPreparation(url, port); }
    catch (error) { failed(error); return; }
    if (preparation.requiresPreparation) {
       latest.current.updatePlaybackStatus({ loading: true, error: '' });
    }
    void preparation.result.then((prepared) => {
      if (!active || !prepared) return;
      if (prepared.sessionReleaseUrl) {
        latest.current.onCompatibilityDetected({ url, progressKey });
        const policy = latest.current.nativePlayback;
        if (policy.allowed && policy.available && policy.preference === 'auto') {
          latest.current.onNativeHandoff({ url, progressKey, kernel: 'mpv', position: 0, paused: false });
          preparation.dispose();
          return;
        }
      }
      setState({ requestKey, port, source: prepared });
    }).catch((error) => { preparation.dispose(); failed(error); });
    return () => { active = false; preparation.dispose(); };
  }, [url, progressKey, enabled, port, requestKey]);

  return enabled && state.requestKey === requestKey && state.port === port ? state.source : null;
}

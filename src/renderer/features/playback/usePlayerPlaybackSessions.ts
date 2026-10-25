import { useHtml5PlaybackSession, type Html5PlaybackSessionOptions } from './useHtml5PlaybackSession';
import { usePlaybackKernelSession, type PlaybackKernelSessionOptions } from './usePlaybackKernelSession';
import { useMediaDiagnostics } from './useMediaDiagnostics';
import type { MediaDiagnosticsPort } from './application/mediaDiagnostics';

export interface PlayerPlaybackSessionsInput {
  html5: Html5PlaybackSessionOptions;
  mpv: PlaybackKernelSessionOptions;
  diagnostics: {
    videoRef: Html5PlaybackSessionOptions['videoRef'];
    active: boolean;
    url: string;
    title?: string;
    port: MediaDiagnosticsPort;
  };
}

/**
 * Composes the lifecycles that own media engines and their listeners.
 * UI orchestration supplies session inputs; this boundary owns which playback
 * sessions and diagnostics are mounted together.
 */
export function usePlayerPlaybackSessions({ html5, mpv, diagnostics }: PlayerPlaybackSessionsInput): void {
  useHtml5PlaybackSession(html5, diagnostics.port);
  useMediaDiagnostics(diagnostics.videoRef, diagnostics.active, diagnostics.url, diagnostics.title, diagnostics.port);
  usePlaybackKernelSession(mpv);
}

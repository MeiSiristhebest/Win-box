import { useEffect } from 'react';
import { cuesToSrt, shiftCues, type SubtitleCue } from '../../../engine/subtitle/parseSubtitle';
import { mpvSubPos } from '../../../shared/player';
import type { Kernel } from '../../lib/kernel';
import type { SubtitlePlaybackPort } from './application/subtitlePlaybackPort';

interface NativeSubtitleTrackOptions {
  allowMpv: boolean;
  kernel: Kernel;
  enabled: boolean;
  cues: SubtitleCue[];
  offset: number;
  fontSize: number;
  bottom: number;
  activeSubtitle: string;
  port: SubtitlePlaybackPort;
}

export function useNativeSubtitleTrack({
  allowMpv,
  kernel,
  enabled,
  cues,
  offset,
  fontSize,
  bottom,
  activeSubtitle,
  port,
}: NativeSubtitleTrackOptions): void {
  useEffect(() => {
    if (!allowMpv || kernel === 'html5') return;
    if (!enabled || !cues.length) {
      void port.sendKernelCommand(kernel, { type: 'sub-clear' }).catch(() => undefined);
      return;
    }

    const srt = cuesToSrt(shiftCues(cues, offset));
    if (!srt.trim()) return;
    void port.sendKernelCommand(kernel, { type: 'sub-add', text: srt, fileName: activeSubtitle || 'subtitle.srt' }).catch(() => undefined);
    void port.sendKernelCommand(kernel, { type: 'sub-font', value: fontSize }).catch(() => undefined);
    void port.sendKernelCommand(kernel, { type: 'sub-pos', value: mpvSubPos(bottom, port.viewportHeight()) }).catch(() => undefined);
  }, [allowMpv, kernel, enabled, cues, offset, fontSize, bottom, activeSubtitle, port]);
}

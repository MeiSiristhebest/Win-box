import type { MpvCommand } from '../../../../shared/player';
import type { SubtitleSettings } from '../../../../shared/subtitle';
import type { Kernel } from '../../../lib/kernel';

export type NativeSubtitleKernel = Exclude<Kernel, 'html5'>;

export interface SubtitlePlaybackPort {
  loadSettings(): Promise<SubtitleSettings>;
  saveSettings(patch: Pick<SubtitleSettings, 'fontSize' | 'bottom' | 'enabled'>): Promise<unknown>;
  sendKernelCommand(kernel: NativeSubtitleKernel, command: MpvCommand): Promise<unknown>;
  viewportHeight(): number;
}

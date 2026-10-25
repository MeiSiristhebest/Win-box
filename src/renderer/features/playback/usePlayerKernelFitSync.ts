import { useEffect } from 'react';
import type { MpvCommand } from '../../../shared/player';
import type { Kernel } from '../../lib/kernel';
import type { PlayerFit } from './application/playerPreferences';

interface PlayerKernelFitSyncOptions {
  enabled: boolean;
  kernel: Kernel;
  fit: PlayerFit;
  sendCommand: (command: MpvCommand) => Promise<unknown>;
}

/** Mirrors the selected display fit mode to a managed playback kernel. */
export function usePlayerKernelFitSync({ enabled, kernel, fit, sendCommand }: PlayerKernelFitSyncOptions): void {
  useEffect(() => {
    if (!enabled || kernel === 'html5') return;
    void sendCommand({ type: 'fit', value: fit }).catch(() => undefined);
  }, [enabled, fit, kernel, sendCommand]);
}

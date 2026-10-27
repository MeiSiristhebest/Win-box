import { useEffect } from 'react';
import type { AuxiliaryWindowNavigationPort } from './application/auxiliaryWindowNavigationPort';

export interface AuxiliaryWindowNavigationOptions {
  enabled: boolean;
  navigate(route: string): void;
  port: AuxiliaryWindowNavigationPort;
}

/** Subscribes to late route updates and completes the main-process window-ready handshake. */
export function useAuxiliaryWindowNavigation({ enabled, navigate, port }: AuxiliaryWindowNavigationOptions): void {
  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = port.subscribeToNavigation(navigate);
    const cancelReady = port.schedule(() => { void port.announceReady().catch(() => undefined); });
    return () => {
      cancelReady();
      unsubscribe();
    };
  }, [enabled, navigate, port]);
}

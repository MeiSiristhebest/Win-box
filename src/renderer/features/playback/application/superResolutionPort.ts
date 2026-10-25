import type { SrMode } from '../../../../shared/player';
import type { SrState } from '../../../../shared/plugin';

export interface SuperResolutionPort {
  readCapability(): Promise<SrState>;
  saveMode(mode: SrMode): Promise<unknown>;
  applyMode(mode: SrMode): Promise<{ ok: boolean }>;
}

export interface SuperResolutionFeedback {
  kind: 'ok' | 'error';
  message: string;
}

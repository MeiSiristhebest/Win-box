import type { SubscriptionImportProgressEvent } from '../../shared/types';

export type SubscriptionImportSelection = 'all' | 'failed' | 'pending';

export interface SubscriptionImportProgressPatch {
  state?: Extract<SubscriptionImportProgressEvent['state'], 'resolving' | 'running'>;
  total?: number;
  completed?: number;
  succeeded?: number;
  failed?: number;
  pending?: number;
  currentName?: string;
  message?: string;
}

export interface SubscriptionImportRunnerCheckpoint {
  multiRepoItems?: Array<{ url: string; name?: string }>;
}

export type SubscriptionImportRunner = (
  signal: AbortSignal,
  selection: SubscriptionImportSelection,
  update: (patch: SubscriptionImportProgressPatch) => void,
  checkpoint: SubscriptionImportRunnerCheckpoint,
  saveCheckpoint: (checkpoint: SubscriptionImportRunnerCheckpoint) => void,
) => Promise<string | void>;

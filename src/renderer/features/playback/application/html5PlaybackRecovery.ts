export type Html5HlsFailureType = 'network' | 'media' | 'other';

export interface Html5PlaybackRecoveryDecision {
  kind: 'ignore' | 'retry-network' | 'recover-media' | 'switch-kernel' | 'try-external-player'
    | 'report-failure' | 'external-player-opened' | 'external-player-failed';
  retryCount?: number;
  player?: string;
  error?: string;
}

export interface Html5ExternalFallbackResult {
  opened: boolean;
  player?: string;
  error?: string;
}

/** Owns per-URL retry budgets and stale-event policy; browser and engine calls stay in adapters. */
export function createHtml5PlaybackRecovery() {
  let active = true;
  let networkRetries = 0;
  let mediaRetries = 0;
  let externalFallbackStarted = false;

  return {
    shouldIgnoreMediaError(code: number): boolean {
      return !active || (code === 4 && externalFallbackStarted);
    },

    onMediaError(options: {
      code: number;
      kernelRecoveryStarted: boolean;
      externalFallbackAvailable: boolean;
    }): Html5PlaybackRecoveryDecision {
      if (!active || options.kernelRecoveryStarted) return { kind: 'ignore' };
      if (options.code === 4 && options.externalFallbackAvailable) {
        if (externalFallbackStarted) return { kind: 'ignore' };
        externalFallbackStarted = true;
        return { kind: 'try-external-player' };
      }
      return { kind: 'report-failure' };
    },

    onHlsFatal(options: { type: Html5HlsFailureType; responseStatus?: number }): Html5PlaybackRecoveryDecision {
      if (!active) return { kind: 'ignore' };
      const upstreamRejected = typeof options.responseStatus === 'number'
        && options.responseStatus >= 400 && options.responseStatus < 500;
      if (options.type === 'network' && !upstreamRejected && networkRetries < 2) {
        networkRetries += 1;
        return { kind: 'retry-network' };
      }
      if (options.type === 'media' && mediaRetries < 2) {
        mediaRetries += 1;
        return { kind: 'recover-media' };
      }
      if (!upstreamRejected) return { kind: 'switch-kernel', retryCount: networkRetries + mediaRetries };
      return { kind: 'report-failure', retryCount: networkRetries + mediaRetries };
    },

    completeExternalFallback(result: Html5ExternalFallbackResult | null): Html5PlaybackRecoveryDecision {
      if (!active) return { kind: 'ignore' };
      if (result?.opened) return { kind: 'external-player-opened', player: result.player };
      return { kind: 'external-player-failed', error: result?.error };
    },

    isActive(): boolean {
      return active;
    },

    cancel(): void {
      active = false;
    },
  };
}

export interface PreparedHtmlMediaSource {
  source: string;
  url: string;
  width?: number;
  height?: number;
  sessionReleaseUrl?: string;
}

export interface HtmlMediaSourcePort {
  requiresPreparation(url: string): boolean;
  prepare(url: string, signal: AbortSignal): Promise<PreparedHtmlMediaSource>;
  release(sessionReleaseUrl: string): void;
}

/** Owns one preparation request and its optional compatibility-stream lease. */
export function createHtmlMediaPreparation(url: string, port: HtmlMediaSourcePort) {
  const requiresPreparation = port.requiresPreparation(url);
  const cancellation = new AbortController();
  let disposed = false;
  let sessionReleaseUrl = '';
  const release = () => {
    const target = sessionReleaseUrl;
    sessionReleaseUrl = '';
    if (!target) return;
    try { port.release(target); } catch { /* Cleanup must not mask a playback failure. */ }
  };
  const result: Promise<PreparedHtmlMediaSource | null> = Promise.resolve().then(async () => {
    if (disposed) return null;
    try {
      const prepared = requiresPreparation ? await port.prepare(url, cancellation.signal) : { source: url, url };
      sessionReleaseUrl = prepared.sessionReleaseUrl || '';
      if (disposed) { release(); return null; }
      return prepared;
    } catch (error) {
      if (disposed) return null;
      throw error;
    }
  });
  return {
    requiresPreparation,
    result,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      cancellation.abort();
      release();
    },
  };
}

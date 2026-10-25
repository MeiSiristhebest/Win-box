import type { PlayResult, SourceBean } from '../../shared/types';
import type { SourceExecutionContextValue, SourceExecutionResolverPort } from './SourceExecutionContext';

export interface PlaybackRequestDiagnostic extends Record<string, unknown> {
  kind: 'play';
  stage: 'done' | 'failed';
  ok: boolean;
  ms: number;
  key: string;
  flag: string;
  ep: string;
  parse?: number;
  needBind?: string;
  msg?: string;
  url?: string;
  reason?: string;
}

export interface SpiderPlaybackRequestPorts {
  execution: SourceExecutionResolverPort;
  playback: {
    execute(key: string, flag: string, id: string, context: SourceExecutionContextValue, source: SourceBean): Promise<PlayResult>;
  };
  startTimer(): { ms(): number };
  episodeFingerprint(id: string): string;
  safeUrlSummary(url: string): string;
  directPlayUrlError(url: string): string;
  recordDiagnostic(event: PlaybackRequestDiagnostic): void;
}

/** Resolves a profile-scoped playback request and records diagnostics around the playback use case. */
export class SpiderPlaybackRequestService {
  constructor(private readonly ports: SpiderPlaybackRequestPorts) {}

  async execute(key: string, flag: string, id: string, profileId?: string): Promise<PlayResult> {
    const timer = this.ports.startTimer();
    try {
      const context = this.ports.execution.forProfile(profileId);
      const source: SourceBean | null = this.ports.execution.forSource(context, key);
      if (!source) throw new Error(`源不存在: ${key}`);

      let result = await this.ports.playback.execute(key, flag, id, context, source);
      if (result.parse === 0) {
        const error = this.ports.directPlayUrlError(result.url);
        if (error) result = { ...result, parse: 1, url: '', playUrl: '', message: result.message || error };
      }
      this.record({
        kind: 'play',
        stage: 'done',
        ok: result.parse === 0 && !!result.url,
        ms: timer.ms(),
        key,
        flag,
        ep: this.ports.episodeFingerprint(id),
        parse: result.parse,
        needBind: result.needDriveCookieBind,
        msg: result.message ? String(result.message).slice(0, 120) : undefined,
        url: result.url ? this.ports.safeUrlSummary(result.url) : undefined,
      });
      return result;
    } catch (error) {
      this.record({
        kind: 'play',
        stage: 'failed',
        ok: false,
        ms: timer.ms(),
        key,
        flag,
        ep: this.ports.episodeFingerprint(id),
        reason: String((error as Error)?.message ?? error).slice(0, 200),
      });
      throw error;
    }
  }

  private record(event: PlaybackRequestDiagnostic): void {
    try {
      this.ports.recordDiagnostic(event);
    } catch {
      // Diagnostics must never replace the playback result or its original error.
    }
  }
}
